-- 027_alerts_and_notifications.sql
-- The alerting subsystem: critical controls, the alerts they raise, the
-- corrective actions that answer them, the escalations that chase them, and
-- the notifications that tell people.
--
-- One migration for all five because they are one mechanism, not five features:
--
--   critical control   "mortality must stay under 0.5% a day"
--         ↓ breached
--   alert              "House 3 hit 0.9% on 2026-08-26"
--         ↓ assigned
--   corrective action  "vet called, feed checked, ventilation adjusted"
--         ↓ ignored too long
--   escalation         "still open after 24h — tell the general manager"
--         ↓ delivered
--   notification       an inbox row, and maybe an email
--
-- Splitting them would put each arrow across a module boundary.
--
-- The design rule that shapes everything here: **an alert is raised by data, not
-- by a person.** Jobs evaluate controls and insert alerts, so the tables must be
-- writable by a background process that has an organization context but no
-- logged-in user. That is why `raised_by` is nullable everywhere and why
-- `source` records what produced the row.

-- ---------------------------------------------------- critical controls ----
-- The thresholds a company decides it must not cross. Per organization, because
-- an acceptable mortality rate is a commercial decision, not a constant.
CREATE TABLE critical_controls (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  code             text NOT NULL,
  name             text NOT NULL,
  description      text,
  -- Which subsystem evaluates it. Determines the job that picks it up.
  domain           text NOT NULL,
  -- The measurement being checked, e.g. 'daily_mortality_rate', 'feed_variance'.
  metric           text NOT NULL,
  comparison       text NOT NULL DEFAULT 'greater_than',
  threshold        numeric(14,4) NOT NULL,
  -- Some controls only bite after N consecutive breaches: one bad day of feed
  -- intake is weather, three is a problem.
  consecutive_periods integer NOT NULL DEFAULT 1,
  severity         text NOT NULL DEFAULT 'high',
  -- How long the owner of an alert has before it escalates.
  response_hours   integer NOT NULL DEFAULT 24,
  is_active        boolean NOT NULL DEFAULT true,
  created_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT critical_controls_code_unique_per_org UNIQUE (organization_id, code),
  CONSTRAINT critical_controls_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT critical_controls_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT critical_controls_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT critical_controls_domain_check
    CHECK (domain IN ('poultry', 'pigs', 'agriculture', 'attendance',
                      'inventory', 'maintenance', 'finance', 'hr', 'security',
                      'general')),
  CONSTRAINT critical_controls_metric_format
    CHECK (metric ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT critical_controls_comparison_check
    CHECK (comparison IN ('greater_than', 'greater_or_equal', 'less_than',
                          'less_or_equal', 'equal', 'not_equal')),
  CONSTRAINT critical_controls_severity_check
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT critical_controls_periods_positive
    CHECK (consecutive_periods BETWEEN 1 AND 30),
  CONSTRAINT critical_controls_response_hours_positive
    CHECK (response_hours BETWEEN 1 AND 8760)
);

CREATE TRIGGER critical_controls_set_updated_at
  BEFORE UPDATE ON critical_controls
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX critical_controls_domain_idx
  ON critical_controls (organization_id, domain) WHERE is_active;

SELECT enable_tenant_rls('critical_controls');

-- ---------------------------------------------------------------- alerts ----
CREATE TABLE alerts (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  -- Null when the alert came from something other than a control breach, e.g. a
  -- person raising a concern by hand.
  control_id       uuid,
  province_id      uuid,
  site_id          uuid,
  reference        text NOT NULL,
  title            text NOT NULL,
  detail           text,
  domain           text NOT NULL DEFAULT 'general',
  severity         text NOT NULL DEFAULT 'medium',
  status           text NOT NULL DEFAULT 'open',
  -- What produced this row. 'job' alerts are raised with no logged-in user.
  source           text NOT NULL DEFAULT 'job',
  -- The measured value that tripped the control, kept so the alert still means
  -- something after the underlying record changes.
  observed_value   numeric(14,4),
  threshold_value  numeric(14,4),
  -- Polymorphic pointer to whatever the alert is about — a flock, a pen, an
  -- asset. Deliberately not a foreign key: it can address any of ~100 tables,
  -- and 100 nullable FK columns would be worse than a checked pair. The table
  -- name is validated on write by the service, and a dangling pointer degrades
  -- to "no link" in the UI rather than breaking the alert.
  subject_table    text,
  subject_id       uuid,
  raised_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  assigned_to      uuid,
  -- When a response becomes overdue. Set from the control's response_hours.
  due_at           timestamptz,
  acknowledged_at  timestamptz,
  acknowledged_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  resolved_at      timestamptz,
  resolved_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  resolution_note  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT alerts_reference_unique_per_org UNIQUE (organization_id, reference),
  CONSTRAINT alerts_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT alerts_control_fk
    FOREIGN KEY (organization_id, control_id)
    REFERENCES critical_controls (organization_id, id) ON DELETE SET NULL (control_id),
  CONSTRAINT alerts_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL (province_id),
  CONSTRAINT alerts_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE SET NULL (site_id),
  -- Assignment is to a member, so it cannot name someone outside the company.
  CONSTRAINT alerts_assigned_fk
    FOREIGN KEY (organization_id, assigned_to)
    REFERENCES organization_members (organization_id, id)
    ON DELETE SET NULL (assigned_to),
  CONSTRAINT alerts_severity_check
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT alerts_status_check
    CHECK (status IN ('open', 'acknowledged', 'in_progress', 'resolved',
                      'dismissed')),
  CONSTRAINT alerts_source_check
    CHECK (source IN ('job', 'manual', 'import', 'integration')),
  CONSTRAINT alerts_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT alerts_reference_format
    CHECK (reference ~ '^[A-Za-z0-9][A-Za-z0-9_/-]{0,62}$'),
  -- A subject is both columns or neither; half a pointer is unusable.
  CONSTRAINT alerts_subject_complete
    CHECK ((subject_table IS NULL) = (subject_id IS NULL)),
  CONSTRAINT alerts_subject_table_format
    CHECK (subject_table IS NULL OR subject_table ~ '^[a-z][a-z0-9_]{1,62}$'),
  -- Resolution must say who and when, or it is not auditable.
  CONSTRAINT alerts_resolution_complete
    CHECK (status NOT IN ('resolved', 'dismissed')
           OR (resolved_at IS NOT NULL))
);

CREATE TRIGGER alerts_set_updated_at
  BEFORE UPDATE ON alerts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The dashboard's main query: what is open, worst first.
CREATE INDEX alerts_open_idx
  ON alerts (organization_id, severity, created_at DESC)
  WHERE status IN ('open', 'acknowledged', 'in_progress');
CREATE INDEX alerts_province_idx
  ON alerts (organization_id, province_id, created_at DESC);
-- Drives the escalation job: anything past due and still unresolved.
CREATE INDEX alerts_overdue_idx
  ON alerts (organization_id, due_at)
  WHERE status IN ('open', 'acknowledged', 'in_progress') AND due_at IS NOT NULL;
CREATE INDEX alerts_subject_idx
  ON alerts (organization_id, subject_table, subject_id)
  WHERE subject_id IS NOT NULL;

SELECT enable_tenant_rls('alerts');

-- ------------------------------------------------------------ dedupe key ----
-- Without this, a job that runs hourly raises the same alert every hour and the
-- inbox becomes useless. The key is whatever the raising code decides makes two
-- alerts "the same occurrence" — typically control + subject + day.
ALTER TABLE alerts ADD COLUMN dedupe_key text;

CREATE UNIQUE INDEX alerts_dedupe_unique
  ON alerts (organization_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL
    AND status IN ('open', 'acknowledged', 'in_progress');

COMMENT ON INDEX alerts_dedupe_unique IS
  'One live alert per occurrence. Partial on open statuses so the same control may fire again after the previous one is resolved.';

-- ------------------------------------------------- corrective actions ----
CREATE TABLE corrective_actions (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  -- Usually answers an alert, but a corrective action can also come out of an
  -- inspection or an incident, so this is nullable.
  alert_id         uuid,
  province_id      uuid,
  site_id          uuid,
  reference        text NOT NULL,
  title            text NOT NULL,
  description      text,
  -- What kind of fix. 'containment' stops the bleeding now; 'preventive' stops
  -- it recurring. Reporting on the ratio is the point of separating them.
  action_type      text NOT NULL DEFAULT 'containment',
  root_cause       text,
  status           text NOT NULL DEFAULT 'planned',
  priority         text NOT NULL DEFAULT 'medium',
  assigned_to      uuid,
  due_on           date,
  completed_on     date,
  completion_note  text,
  verified_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  verified_at      timestamptz,
  created_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT corrective_actions_reference_unique_per_org
    UNIQUE (organization_id, reference),
  CONSTRAINT corrective_actions_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT corrective_actions_alert_fk
    FOREIGN KEY (organization_id, alert_id)
    REFERENCES alerts (organization_id, id) ON DELETE SET NULL (alert_id),
  CONSTRAINT corrective_actions_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL (province_id),
  CONSTRAINT corrective_actions_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE SET NULL (site_id),
  CONSTRAINT corrective_actions_assigned_fk
    FOREIGN KEY (organization_id, assigned_to)
    REFERENCES organization_members (organization_id, id)
    ON DELETE SET NULL (assigned_to),
  CONSTRAINT corrective_actions_type_check
    CHECK (action_type IN ('containment', 'corrective', 'preventive',
                           'investigation')),
  CONSTRAINT corrective_actions_status_check
    CHECK (status IN ('planned', 'in_progress', 'completed', 'verified',
                      'cancelled')),
  CONSTRAINT corrective_actions_priority_check
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  CONSTRAINT corrective_actions_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT corrective_actions_reference_format
    CHECK (reference ~ '^[A-Za-z0-9][A-Za-z0-9_/-]{0,62}$'),
  CONSTRAINT corrective_actions_completed_when_done
    CHECK (status NOT IN ('completed', 'verified') OR completed_on IS NOT NULL),
  -- Verification is a second pair of eyes; it needs both who and when.
  CONSTRAINT corrective_actions_verified_complete
    CHECK (status <> 'verified'
           OR (verified_by IS NOT NULL AND verified_at IS NOT NULL))
);

CREATE TRIGGER corrective_actions_set_updated_at
  BEFORE UPDATE ON corrective_actions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX corrective_actions_open_idx
  ON corrective_actions (organization_id, due_on)
  WHERE status IN ('planned', 'in_progress');
CREATE INDEX corrective_actions_alert_idx
  ON corrective_actions (organization_id, alert_id)
  WHERE alert_id IS NOT NULL;

SELECT enable_tenant_rls('corrective_actions');

-- ------------------------------------------------------------ escalations ----
-- A record that an unanswered alert was pushed up a level. Kept as its own
-- table rather than a counter on the alert, because "who was told, when, and
-- did they respond" is the audit trail that makes escalation meaningful.
CREATE TABLE escalations (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  alert_id          uuid NOT NULL,
  -- 1 is the first push above the assignee, 2 the next, and so on.
  level             integer NOT NULL DEFAULT 1,
  reason            text NOT NULL DEFAULT 'no_response',
  escalated_to      uuid,
  -- Null when raised by the escalation job rather than a person.
  escalated_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  escalated_at      timestamptz NOT NULL DEFAULT now(),
  responded_at      timestamptz,
  response_note     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT escalations_level_unique UNIQUE (organization_id, alert_id, level),
  CONSTRAINT escalations_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT escalations_alert_fk
    FOREIGN KEY (organization_id, alert_id)
    REFERENCES alerts (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT escalations_to_fk
    FOREIGN KEY (organization_id, escalated_to)
    REFERENCES organization_members (organization_id, id)
    ON DELETE SET NULL (escalated_to),
  CONSTRAINT escalations_level_range CHECK (level BETWEEN 1 AND 10),
  CONSTRAINT escalations_reason_check
    CHECK (reason IN ('no_response', 'overdue', 'severity_raised',
                      'repeat_breach', 'manual')),
  CONSTRAINT escalations_responded_after_escalated
    CHECK (responded_at IS NULL OR responded_at >= escalated_at)
);

CREATE INDEX escalations_alert_idx ON escalations (organization_id, alert_id, level);
CREATE INDEX escalations_pending_idx
  ON escalations (organization_id, escalated_at)
  WHERE responded_at IS NULL;

SELECT enable_tenant_rls('escalations');

-- --------------------------------------------------------- notifications ----
-- One row per person per thing they need to know. The in-app inbox is the
-- source of truth; email is a delivery channel on top of it, which is why
-- delivery state lives here rather than in a separate mail log.
CREATE TABLE notifications (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  -- The recipient as a member, not a user: a notification belongs to you *in
  -- this workspace*, and must not follow you into another one.
  member_id        uuid NOT NULL,
  category         text NOT NULL DEFAULT 'general',
  title            text NOT NULL,
  body             text,
  severity         text NOT NULL DEFAULT 'info',
  -- Where clicking it should go, as an app-relative path.
  link_path        text,
  -- Same polymorphic pointer rationale as alerts.subject_*.
  subject_table    text,
  subject_id       uuid,
  read_at          timestamptz,
  -- Email delivery, tracked so a failure is visible instead of silent.
  email_status     text NOT NULL DEFAULT 'not_required',
  email_sent_at    timestamptz,
  email_error      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT notifications_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT notifications_member_fk
    FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT notifications_category_check
    CHECK (category IN ('general', 'alert', 'escalation', 'approval', 'task',
                        'leave', 'payroll', 'training', 'invitation',
                        'maintenance', 'inventory', 'report')),
  CONSTRAINT notifications_severity_check
    CHECK (severity IN ('info', 'warning', 'critical')),
  CONSTRAINT notifications_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT notifications_email_status_check
    CHECK (email_status IN ('not_required', 'pending', 'sent', 'failed')),
  CONSTRAINT notifications_subject_complete
    CHECK ((subject_table IS NULL) = (subject_id IS NULL)),
  CONSTRAINT notifications_link_is_relative
    CHECK (link_path IS NULL OR link_path ~ '^/'),
  CONSTRAINT notifications_email_error_only_on_failure
    CHECK (email_error IS NULL OR email_status = 'failed')
);

-- The inbox query: my unread, newest first.
CREATE INDEX notifications_unread_idx
  ON notifications (organization_id, member_id, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX notifications_member_idx
  ON notifications (organization_id, member_id, created_at DESC);
-- Drives the mail sender: anything queued.
CREATE INDEX notifications_email_pending_idx
  ON notifications (organization_id, created_at)
  WHERE email_status = 'pending';

SELECT enable_tenant_rls('notifications');

-- ------------------------------------------- notification preferences ----
-- Which categories a member wants by email. Absent row means the default, so
-- nobody has to be pre-populated and a new category does not need a backfill.
CREATE TABLE notification_preferences (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  member_id        uuid NOT NULL,
  category         text NOT NULL,
  in_app           boolean NOT NULL DEFAULT true,
  email            boolean NOT NULL DEFAULT false,
  -- Below this severity, do not email even if the category is enabled.
  min_email_severity text NOT NULL DEFAULT 'warning',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT notification_preferences_unique
    UNIQUE (organization_id, member_id, category),
  CONSTRAINT notification_preferences_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT notification_preferences_member_fk
    FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT notification_preferences_category_check
    CHECK (category IN ('general', 'alert', 'escalation', 'approval', 'task',
                        'leave', 'payroll', 'training', 'invitation',
                        'maintenance', 'inventory', 'report')),
  CONSTRAINT notification_preferences_severity_check
    CHECK (min_email_severity IN ('info', 'warning', 'critical'))
);

CREATE TRIGGER notification_preferences_set_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enable_tenant_rls('notification_preferences');

COMMENT ON TABLE alerts IS
  'Raised by data, not people: jobs insert these with no logged-in user, which is why raised_by is nullable.';
COMMENT ON COLUMN alerts.subject_table IS
  'Polymorphic pointer, not a FK: an alert can address any of ~100 tables. Validated on write, degrades to no-link if dangling.';
