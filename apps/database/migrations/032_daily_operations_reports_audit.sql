-- 032_daily_operations_reports_audit.sql
-- The reporting layer: the daily reports people file, the checklists they work
-- through, the shift handovers between them, the saved report definitions, and
-- the audit trail underneath it all.
--
-- 016-020 already record *production* daily data — a poultry daily record, a
-- pig weight. What was missing is the **human** daily layer: the supervisor's
-- end-of-day summary, the checklist that proves the work was done, the handover
-- note the night shift reads. Those are what an owner actually opens in the
-- morning, and they are separate from production data because they are
-- narrative and approval-driven rather than numeric.

-- ------------------------------------------------------ checklist templates ----
CREATE TABLE checklist_templates (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  code              text NOT NULL,
  name              text NOT NULL,
  description       text,
  -- Which part of the operation it belongs to, so the right people see it.
  domain            text NOT NULL DEFAULT 'general',
  frequency         text NOT NULL DEFAULT 'daily',
  -- Optional narrowing: a checklist can be for one site or one department.
  site_id           uuid,
  department_id     uuid,
  is_active         boolean NOT NULL DEFAULT true,
  created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT checklist_templates_code_unique_per_org UNIQUE (organization_id, code),
  CONSTRAINT checklist_templates_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT checklist_templates_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT checklist_templates_department_fk
    FOREIGN KEY (organization_id, department_id)
    REFERENCES departments (organization_id, id) ON DELETE SET NULL (department_id),
  CONSTRAINT checklist_templates_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT checklist_templates_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT checklist_templates_domain_check
    CHECK (domain IN ('general', 'poultry', 'pigs', 'agriculture', 'security',
                      'maintenance', 'biosecurity', 'safety', 'hygiene',
                      'inventory')),
  CONSTRAINT checklist_templates_frequency_check
    CHECK (frequency IN ('per_shift', 'daily', 'weekly', 'monthly', 'ad_hoc'))
);

CREATE TRIGGER checklist_templates_set_updated_at
  BEFORE UPDATE ON checklist_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enable_tenant_rls('checklist_templates');

CREATE TABLE checklist_template_items (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  template_id       uuid NOT NULL,
  position          integer NOT NULL,
  prompt            text NOT NULL,
  -- What kind of answer. A yes/no is not enough for "water meter reading".
  response_type     text NOT NULL DEFAULT 'boolean',
  unit              text,
  is_required       boolean NOT NULL DEFAULT true,
  -- A "no" on a critical item should raise an alert rather than be recorded and
  -- forgotten. Which control it maps to is the link that makes that automatic.
  critical_control_id uuid,
  guidance          text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT checklist_template_items_position_unique
    UNIQUE (organization_id, template_id, position),
  CONSTRAINT checklist_template_items_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT checklist_template_items_template_fk
    FOREIGN KEY (organization_id, template_id)
    REFERENCES checklist_templates (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT checklist_template_items_control_fk
    FOREIGN KEY (organization_id, critical_control_id)
    REFERENCES critical_controls (organization_id, id)
    ON DELETE SET NULL (critical_control_id),
  CONSTRAINT checklist_template_items_prompt_not_blank CHECK (btrim(prompt) <> ''),
  CONSTRAINT checklist_template_items_response_check
    CHECK (response_type IN ('boolean', 'number', 'text', 'choice', 'photo')),
  CONSTRAINT checklist_template_items_position_positive CHECK (position > 0)
);

CREATE TRIGGER checklist_template_items_set_updated_at
  BEFORE UPDATE ON checklist_template_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enable_tenant_rls('checklist_template_items');

-- --------------------------------------------------- completed checklists ----
CREATE TABLE checklist_runs (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  template_id       uuid NOT NULL,
  province_id       uuid,
  site_id           uuid,
  shift_id          uuid,
  -- The business day this covers, in the organization's timezone. See
  -- utils/dates.ts on why this is a date and not a timestamp.
  work_date         date NOT NULL,
  status            text NOT NULL DEFAULT 'in_progress',
  completed_by      uuid,
  completed_at      timestamptz,
  verified_by       uuid,
  verified_at       timestamptz,
  -- Counts kept so a list can show "12 of 14 done, 1 failed" without loading
  -- every response.
  items_total       integer NOT NULL DEFAULT 0,
  items_completed   integer NOT NULL DEFAULT 0,
  items_failed      integer NOT NULL DEFAULT 0,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT checklist_runs_org_id_unique UNIQUE (organization_id, id),
  -- One run per template per day per shift. Without this a checklist gets
  -- filled twice and the completion report double-counts.
  CONSTRAINT checklist_runs_unique_per_day
    UNIQUE (organization_id, template_id, work_date, shift_id),
  CONSTRAINT checklist_runs_template_fk
    FOREIGN KEY (organization_id, template_id)
    REFERENCES checklist_templates (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT checklist_runs_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL (province_id),
  CONSTRAINT checklist_runs_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE SET NULL (site_id),
  CONSTRAINT checklist_runs_shift_fk
    FOREIGN KEY (organization_id, shift_id)
    REFERENCES shifts (organization_id, id) ON DELETE SET NULL (shift_id),
  CONSTRAINT checklist_runs_completed_by_fk
    FOREIGN KEY (organization_id, completed_by)
    REFERENCES employees (organization_id, id) ON DELETE SET NULL (completed_by),
  CONSTRAINT checklist_runs_verified_by_fk
    FOREIGN KEY (organization_id, verified_by)
    REFERENCES organization_members (organization_id, id)
    ON DELETE SET NULL (verified_by),
  CONSTRAINT checklist_runs_status_check
    CHECK (status IN ('in_progress', 'completed', 'verified', 'missed')),
  CONSTRAINT checklist_runs_counts_non_negative
    CHECK (items_total >= 0 AND items_completed >= 0 AND items_failed >= 0),
  CONSTRAINT checklist_runs_counts_within_total
    CHECK (items_completed <= items_total AND items_failed <= items_total),
  CONSTRAINT checklist_runs_completed_complete
    CHECK (status NOT IN ('completed', 'verified') OR completed_at IS NOT NULL),
  CONSTRAINT checklist_runs_verified_complete
    CHECK (status <> 'verified' OR verified_at IS NOT NULL)
);

CREATE TRIGGER checklist_runs_set_updated_at
  BEFORE UPDATE ON checklist_runs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX checklist_runs_date_idx
  ON checklist_runs (organization_id, work_date DESC);
-- Drives the "what was not done today" report.
CREATE INDEX checklist_runs_outstanding_idx
  ON checklist_runs (organization_id, work_date)
  WHERE status IN ('in_progress', 'missed');

SELECT enable_tenant_rls('checklist_runs');

CREATE TABLE checklist_responses (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  run_id            uuid NOT NULL,
  item_id           uuid NOT NULL,
  -- One of these is populated according to the item's response_type. Separate
  -- typed columns rather than one text column, so a number can be averaged and
  -- a boolean can be counted without casting.
  boolean_value     boolean,
  number_value      numeric(16,4),
  text_value        text,
  -- Whether this response counts as a pass. Stored rather than derived because
  -- "is 34 degrees a failure" depends on the control at the time of answering.
  passed            boolean,
  answered_at       timestamptz NOT NULL DEFAULT now(),
  answered_by       uuid,
  comment           text,
  -- Set when a failure raised an alert, so the two are linked both ways.
  alert_id          uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT checklist_responses_unique UNIQUE (organization_id, run_id, item_id),
  CONSTRAINT checklist_responses_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT checklist_responses_run_fk
    FOREIGN KEY (organization_id, run_id)
    REFERENCES checklist_runs (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT checklist_responses_item_fk
    FOREIGN KEY (organization_id, item_id)
    REFERENCES checklist_template_items (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT checklist_responses_answered_by_fk
    FOREIGN KEY (organization_id, answered_by)
    REFERENCES employees (organization_id, id) ON DELETE SET NULL (answered_by),
  CONSTRAINT checklist_responses_alert_fk
    FOREIGN KEY (organization_id, alert_id)
    REFERENCES alerts (organization_id, id) ON DELETE SET NULL (alert_id),
  -- Exactly one value column, or none for a skipped optional item.
  CONSTRAINT checklist_responses_one_value
    CHECK (
      (CASE WHEN boolean_value IS NOT NULL THEN 1 ELSE 0 END
       + CASE WHEN number_value IS NOT NULL THEN 1 ELSE 0 END
       + CASE WHEN text_value IS NOT NULL THEN 1 ELSE 0 END) <= 1
    )
);

CREATE INDEX checklist_responses_run_idx
  ON checklist_responses (organization_id, run_id);
CREATE INDEX checklist_responses_failed_idx
  ON checklist_responses (organization_id, answered_at DESC)
  WHERE passed = false;

SELECT enable_tenant_rls('checklist_responses');

-- --------------------------------------------------------- daily reports ----
-- The narrative end-of-day report, filed by role. An employee's report rolls up
-- into a supervisor's, which rolls up into a manager's, which becomes the
-- owner's digest. `parent_report_id` is what makes that chain queryable.
CREATE TABLE daily_reports (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  work_date         date NOT NULL,
  report_level      text NOT NULL,
  province_id       uuid,
  site_id           uuid,
  department_id     uuid,
  shift_id          uuid,
  employee_id       uuid,
  parent_report_id  uuid,
  summary           text NOT NULL,
  work_done         text,
  problems          text,
  help_needed       text,
  -- Free-form figures the filer wants to highlight, e.g. birds moved, bags used.
  -- jsonb rather than columns because what matters differs by role and site, and
  -- adding a column per metric would never end. Reporting reads specific keys.
  metrics           jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            text NOT NULL DEFAULT 'submitted',
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  reviewed_by       uuid,
  reviewed_at       timestamptz,
  review_note       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT daily_reports_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT daily_reports_parent_fk
    FOREIGN KEY (organization_id, parent_report_id)
    REFERENCES daily_reports (organization_id, id) ON DELETE SET NULL (parent_report_id),
  CONSTRAINT daily_reports_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL (province_id),
  CONSTRAINT daily_reports_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE SET NULL (site_id),
  CONSTRAINT daily_reports_department_fk
    FOREIGN KEY (organization_id, department_id)
    REFERENCES departments (organization_id, id) ON DELETE SET NULL (department_id),
  CONSTRAINT daily_reports_shift_fk
    FOREIGN KEY (organization_id, shift_id)
    REFERENCES shifts (organization_id, id) ON DELETE SET NULL (shift_id),
  CONSTRAINT daily_reports_employee_fk
    FOREIGN KEY (organization_id, employee_id)
    REFERENCES employees (organization_id, id) ON DELETE SET NULL (employee_id),
  CONSTRAINT daily_reports_reviewer_fk
    FOREIGN KEY (organization_id, reviewed_by)
    REFERENCES organization_members (organization_id, id)
    ON DELETE SET NULL (reviewed_by),
  CONSTRAINT daily_reports_level_check
    CHECK (report_level IN ('employee', 'supervisor', 'manager', 'owner_digest')),
  CONSTRAINT daily_reports_status_check
    CHECK (status IN ('draft', 'submitted', 'reviewed', 'flagged')),
  CONSTRAINT daily_reports_summary_not_blank CHECK (btrim(summary) <> ''),
  CONSTRAINT daily_reports_metrics_is_object
    CHECK (jsonb_typeof(metrics) = 'object'),
  CONSTRAINT daily_reports_reviewed_complete
    CHECK (status <> 'reviewed' OR reviewed_at IS NOT NULL),
  CONSTRAINT daily_reports_no_self_parent
    CHECK (parent_report_id IS NULL OR parent_report_id <> id),
  -- An employee-level report must say who filed it.
  CONSTRAINT daily_reports_employee_level_named
    CHECK (report_level <> 'employee' OR employee_id IS NOT NULL)
);

CREATE TRIGGER daily_reports_set_updated_at
  BEFORE UPDATE ON daily_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One report per person per day per level; refiling edits rather than duplicates.
CREATE UNIQUE INDEX daily_reports_employee_unique
  ON daily_reports (organization_id, employee_id, work_date, report_level)
  WHERE employee_id IS NOT NULL;

CREATE INDEX daily_reports_date_idx
  ON daily_reports (organization_id, work_date DESC, report_level);
CREATE INDEX daily_reports_pending_review_idx
  ON daily_reports (organization_id, work_date DESC)
  WHERE status = 'submitted';
-- Lets reporting read specific metric keys without scanning every row.
CREATE INDEX daily_reports_metrics_gin
  ON daily_reports USING gin (metrics jsonb_path_ops);

SELECT enable_tenant_rls('daily_reports');

-- ------------------------------------------------------- shift handovers ----
-- What the outgoing shift tells the incoming one. Its own table rather than a
-- daily_report level, because a handover is between two named shifts and has an
-- acknowledgement — the incoming supervisor confirms they read it.
CREATE TABLE shift_handovers (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  work_date         date NOT NULL,
  province_id       uuid,
  site_id           uuid NOT NULL,
  outgoing_shift_id uuid,
  incoming_shift_id uuid,
  outgoing_employee_id uuid,
  incoming_employee_id uuid,
  handed_over_at    timestamptz NOT NULL DEFAULT now(),
  summary           text NOT NULL,
  outstanding_work  text,
  -- The things that must not be missed: a sick animal, a broken feeder, a
  -- pending delivery.
  urgent_items      text,
  equipment_status  text,
  acknowledged_at   timestamptz,
  acknowledged_by   uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT shift_handovers_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT shift_handovers_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT shift_handovers_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL (province_id),
  CONSTRAINT shift_handovers_outgoing_shift_fk
    FOREIGN KEY (organization_id, outgoing_shift_id)
    REFERENCES shifts (organization_id, id) ON DELETE SET NULL (outgoing_shift_id),
  CONSTRAINT shift_handovers_incoming_shift_fk
    FOREIGN KEY (organization_id, incoming_shift_id)
    REFERENCES shifts (organization_id, id) ON DELETE SET NULL (incoming_shift_id),
  CONSTRAINT shift_handovers_outgoing_employee_fk
    FOREIGN KEY (organization_id, outgoing_employee_id)
    REFERENCES employees (organization_id, id)
    ON DELETE SET NULL (outgoing_employee_id),
  CONSTRAINT shift_handovers_incoming_employee_fk
    FOREIGN KEY (organization_id, incoming_employee_id)
    REFERENCES employees (organization_id, id)
    ON DELETE SET NULL (incoming_employee_id),
  CONSTRAINT shift_handovers_acknowledged_by_fk
    FOREIGN KEY (organization_id, acknowledged_by)
    REFERENCES employees (organization_id, id)
    ON DELETE SET NULL (acknowledged_by),
  CONSTRAINT shift_handovers_summary_not_blank CHECK (btrim(summary) <> ''),
  CONSTRAINT shift_handovers_acknowledged_complete
    CHECK (acknowledged_at IS NULL OR acknowledged_by IS NOT NULL),
  -- A handover between the same shift is a data-entry error.
  CONSTRAINT shift_handovers_shifts_differ
    CHECK (outgoing_shift_id IS NULL OR incoming_shift_id IS NULL
           OR outgoing_shift_id <> incoming_shift_id)
);

CREATE TRIGGER shift_handovers_set_updated_at
  BEFORE UPDATE ON shift_handovers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX shift_handovers_date_idx
  ON shift_handovers (organization_id, site_id, work_date DESC);
CREATE INDEX shift_handovers_unacknowledged_idx
  ON shift_handovers (organization_id, handed_over_at)
  WHERE acknowledged_at IS NULL;

SELECT enable_tenant_rls('shift_handovers');

-- ---------------------------------------------------- report definitions ----
-- Saved reports: a named set of filters over one of the built-in report kinds,
-- optionally on a schedule. Not a query builder — `report_kind` names code that
-- knows how to run it, and `parameters` holds only the filters. Storing SQL
-- here would be an injection surface and a migration hazard.
CREATE TABLE report_definitions (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  code              text NOT NULL,
  name              text NOT NULL,
  description       text,
  report_kind       text NOT NULL,
  parameters        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Scheduled delivery. NULL schedule means run-on-demand only.
  schedule          text,
  -- Members who receive it. An array rather than a join table: this list is
  -- always read whole, never queried across, and is short.
  recipient_member_ids uuid[] NOT NULL DEFAULT '{}',
  output_format     text NOT NULL DEFAULT 'pdf',
  province_id       uuid,
  is_active         boolean NOT NULL DEFAULT true,
  last_run_at       timestamptz,
  created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT report_definitions_code_unique_per_org UNIQUE (organization_id, code),
  CONSTRAINT report_definitions_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT report_definitions_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL (province_id),
  CONSTRAINT report_definitions_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT report_definitions_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT report_definitions_kind_check
    CHECK (report_kind IN ('employee_summary', 'attendance', 'payroll',
                           'poultry_production', 'pig_production',
                           'agriculture_production', 'mortality', 'inventory',
                           'purchases', 'sales', 'receivables', 'payables',
                           'cash_flow', 'trial_balance', 'profit_and_loss',
                           'incidents', 'alerts', 'checklist_compliance',
                           'training_compliance', 'owner_digest')),
  CONSTRAINT report_definitions_schedule_check
    CHECK (schedule IS NULL
           OR schedule IN ('daily', 'weekly', 'monthly', 'quarterly')),
  CONSTRAINT report_definitions_format_check
    CHECK (output_format IN ('pdf', 'xlsx', 'csv', 'json')),
  CONSTRAINT report_definitions_parameters_is_object
    CHECK (jsonb_typeof(parameters) = 'object')
);

CREATE TRIGGER report_definitions_set_updated_at
  BEFORE UPDATE ON report_definitions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX report_definitions_scheduled_idx
  ON report_definitions (organization_id, schedule)
  WHERE is_active AND schedule IS NOT NULL;

SELECT enable_tenant_rls('report_definitions');

-- --------------------------------------------------------- report runs ----
CREATE TABLE report_runs (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  definition_id     uuid,
  report_kind       text NOT NULL,
  parameters        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The period the report covers, which is not when it was run.
  period_start      date,
  period_end        date,
  status            text NOT NULL DEFAULT 'queued',
  output_format     text NOT NULL DEFAULT 'pdf',
  document_id       uuid,
  row_count         integer,
  -- How long it took, so a report that becomes slow is visible.
  duration_ms       integer,
  error_message     text,
  requested_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  started_at        timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT report_runs_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT report_runs_definition_fk
    FOREIGN KEY (organization_id, definition_id)
    REFERENCES report_definitions (organization_id, id)
    ON DELETE SET NULL (definition_id),
  CONSTRAINT report_runs_document_fk
    FOREIGN KEY (organization_id, document_id)
    REFERENCES documents (organization_id, id) ON DELETE SET NULL (document_id),
  CONSTRAINT report_runs_status_check
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  CONSTRAINT report_runs_format_check
    CHECK (output_format IN ('pdf', 'xlsx', 'csv', 'json')),
  CONSTRAINT report_runs_period_check
    CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start),
  CONSTRAINT report_runs_error_only_on_failure
    CHECK (error_message IS NULL OR status = 'failed'),
  CONSTRAINT report_runs_completed_complete
    CHECK (status NOT IN ('completed', 'failed') OR completed_at IS NOT NULL)
);

CREATE INDEX report_runs_recent_idx
  ON report_runs (organization_id, created_at DESC);
CREATE INDEX report_runs_queued_idx
  ON report_runs (organization_id, created_at)
  WHERE status IN ('queued', 'running');

SELECT enable_tenant_rls('report_runs');

-- ------------------------------------------------------------ audit trail ----
-- Who changed what, when, from where.
--
-- Two properties make this different from every other table here:
--
-- 1. **Append-only.** A trigger refuses UPDATE and DELETE. An audit trail that
--    can be edited is not evidence of anything.
-- 2. **The actor may be gone.** `user_id` is nullable with ON DELETE SET NULL,
--    but `actor_email` is copied at write time — so the trail still says who did
--    it after the account is deleted. Losing the account must not launder the
--    action.
CREATE TABLE audit_log (
  id                bigserial NOT NULL,
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  -- The actor. Null user_id with a populated actor_email means the account has
  -- since been removed; null both means a background job.
  user_id           uuid REFERENCES users (id) ON DELETE SET NULL,
  member_id         uuid,
  actor_email       text,
  actor_name        text,
  -- What was done.
  action            text NOT NULL,
  entity_table      text NOT NULL,
  entity_id         uuid,
  -- Human-readable label of the affected row, copied so the entry stays
  -- meaningful after the row is deleted.
  entity_label      text,
  -- Field-level before/after for updates. jsonb because the shape differs per
  -- table and only changed keys are stored, which keeps this table small.
  changes           jsonb,
  -- Request provenance, for answering "was this really them".
  ip_address        text,
  user_agent        text,
  request_id        text,
  -- Which HTTP route, so a suspicious pattern can be traced to an endpoint.
  route             text,
  severity          text NOT NULL DEFAULT 'info',
  PRIMARY KEY (id),
  CONSTRAINT audit_log_member_fk
    FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members (organization_id, id)
    ON DELETE SET NULL (member_id),
  CONSTRAINT audit_log_action_check
    CHECK (action IN ('create', 'read', 'update', 'delete', 'login',
                      'login_failed', 'logout', 'approve', 'reject', 'export',
                      'import', 'invite', 'permission_change', 'role_change',
                      'password_change', 'switch_organization', 'post',
                      'reverse', 'cancel')),
  CONSTRAINT audit_log_entity_table_format
    CHECK (entity_table ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT audit_log_severity_check
    CHECK (severity IN ('info', 'notice', 'warning', 'critical')),
  CONSTRAINT audit_log_changes_is_object
    CHECK (changes IS NULL OR jsonb_typeof(changes) = 'object')
);

-- The three questions actually asked of an audit trail.
CREATE INDEX audit_log_recent_idx ON audit_log (organization_id, occurred_at DESC);
CREATE INDEX audit_log_entity_idx
  ON audit_log (organization_id, entity_table, entity_id, occurred_at DESC);
CREATE INDEX audit_log_actor_idx
  ON audit_log (organization_id, user_id, occurred_at DESC)
  WHERE user_id IS NOT NULL;
-- Security review: everything notable, newest first.
CREATE INDEX audit_log_severity_idx
  ON audit_log (organization_id, occurred_at DESC)
  WHERE severity IN ('warning', 'critical');

SELECT enable_tenant_rls('audit_log');

-- Append-only, enforced. Note this blocks the table owner too, because
-- enable_tenant_rls forces row security and this trigger has no exemption.
CREATE OR REPLACE FUNCTION audit_log_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'audit_log is append-only; % is not permitted', TG_OP
    USING ERRCODE = 'check_violation',
          HINT = 'Record a compensating entry instead of altering history.';
END;
$$;

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_reject_mutation();

COMMENT ON TABLE audit_log IS
  'Append-only: a trigger refuses UPDATE and DELETE. actor_email is copied at write time so the trail survives the account being deleted.';
COMMENT ON COLUMN daily_reports.metrics IS
  'jsonb because what matters differs per role and site; a column per metric would never end. GIN indexed for key lookups.';
COMMENT ON COLUMN report_definitions.report_kind IS
  'Names code that knows how to run the report. Storing SQL here would be an injection surface.';
