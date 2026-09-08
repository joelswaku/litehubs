-- 026_hr_records.sql
-- The employee lifecycle records that sit beside attendance: leave, training,
-- disciplinary actions and appraisals.
--
-- One migration and (later) one module for all four, rather than four of each.
-- They share the same shape — a record about one employee, raised on a date,
-- moving through a small approval state machine, scoped to that employee's
-- province — and splitting them would mean four copies of the same scoping and
-- approval code. `owner_management` already proves one module can carry nine
-- related record types without becoming unclear.
--
-- Province is denormalised onto every record on purpose. An employee can be
-- transferred, and a leave request must stay visible to the manager of the
-- province it was *approved in*, not follow the employee to a new one. It also
-- keeps the province filter a single-table predicate instead of a join on every
-- list query.

-- GiST indexes handle range overlap natively but have no operator class for
-- plain equality on uuid, which the leave_requests exclusion constraint needs
-- in order to scope the overlap check to one organization and one employee.
-- btree_gist supplies it.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- --------------------------------------------------------- leave types ----
-- Per-organization, because entitlements are set by local law and company
-- policy. A DR Congo employer's annual leave is not a Kenyan employer's.
CREATE TABLE leave_types (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  code              text NOT NULL,
  name              text NOT NULL,
  -- Days granted per calendar year. NULL means unlimited/unmetered, which is
  -- how unpaid and compassionate leave usually work.
  annual_entitlement_days numeric(5,1),
  is_paid           boolean NOT NULL DEFAULT true,
  requires_approval boolean NOT NULL DEFAULT true,
  -- Whether a request may be filed after the fact. Sick leave usually can be;
  -- annual leave usually cannot.
  allows_backdating boolean NOT NULL DEFAULT false,
  is_active         boolean NOT NULL DEFAULT true,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT leave_types_code_unique_per_org UNIQUE (organization_id, code),
  CONSTRAINT leave_types_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT leave_types_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT leave_types_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT leave_types_entitlement_range
    CHECK (annual_entitlement_days IS NULL
           OR (annual_entitlement_days >= 0 AND annual_entitlement_days <= 366)),
  CONSTRAINT leave_types_notes_not_blank CHECK (notes IS NULL OR btrim(notes) <> '')
);

CREATE TRIGGER leave_types_set_updated_at
  BEFORE UPDATE ON leave_types
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enable_tenant_rls('leave_types');

-- ------------------------------------------------------ leave requests ----
CREATE TABLE leave_requests (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL,
  leave_type_id   uuid NOT NULL,
  province_id     uuid,
  site_id         uuid,
  starts_on       date NOT NULL,
  ends_on         date NOT NULL,
  -- Stored rather than derived: the working-day count depends on the roster and
  -- public holidays as they stood when the request was filed, and recomputing
  -- it later would silently change an approved figure.
  requested_days  numeric(5,1) NOT NULL,
  reason          text,
  status          text NOT NULL DEFAULT 'pending',
  -- Who asked. Usually the employee, but a supervisor may file on their behalf
  -- for someone without a login.
  requested_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT leave_requests_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT leave_requests_employee_fk
    FOREIGN KEY (organization_id, employee_id)
    REFERENCES employees (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT leave_requests_type_fk
    FOREIGN KEY (organization_id, leave_type_id)
    REFERENCES leave_types (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT leave_requests_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL (province_id),
  CONSTRAINT leave_requests_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE SET NULL (site_id),
  CONSTRAINT leave_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'taken')),
  CONSTRAINT leave_requests_dates_check CHECK (ends_on >= starts_on),
  CONSTRAINT leave_requests_days_positive CHECK (requested_days > 0),
  CONSTRAINT leave_requests_reason_not_blank
    CHECK (reason IS NULL OR btrim(reason) <> ''),
  -- A decision must record who made it and when, or it is not auditable.
  CONSTRAINT leave_requests_decision_complete
    CHECK ((status IN ('pending', 'cancelled'))
           OR (decided_at IS NOT NULL AND decided_by IS NOT NULL))
);

CREATE TRIGGER leave_requests_set_updated_at
  BEFORE UPDATE ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX leave_requests_employee_idx
  ON leave_requests (organization_id, employee_id, starts_on DESC);
CREATE INDEX leave_requests_pending_idx
  ON leave_requests (organization_id, province_id, starts_on)
  WHERE status = 'pending';

-- Two approved leaves cannot overlap for one employee. Written as an exclusion
-- constraint because a UNIQUE cannot express "ranges must not intersect", and
-- catching it in application code loses the race between two approvers.
ALTER TABLE leave_requests
  ADD CONSTRAINT leave_requests_no_overlap
  EXCLUDE USING gist (
    organization_id WITH =,
    employee_id WITH =,
    daterange(starts_on, ends_on, '[]') WITH &&
  ) WHERE (status IN ('approved', 'taken'));

SELECT enable_tenant_rls('leave_requests');

-- ------------------------------------------------------- leave balances ----
-- Materialised per employee per type per year. Derivable from requests, but
-- kept because the entitlement in force can change mid-year and a balance has
-- to remember what it was granted under.
CREATE TABLE leave_balances (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  employee_id       uuid NOT NULL,
  leave_type_id     uuid NOT NULL,
  leave_year        integer NOT NULL,
  entitled_days     numeric(5,1) NOT NULL DEFAULT 0,
  carried_over_days numeric(5,1) NOT NULL DEFAULT 0,
  taken_days        numeric(5,1) NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT leave_balances_unique
    UNIQUE (organization_id, employee_id, leave_type_id, leave_year),
  CONSTRAINT leave_balances_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT leave_balances_employee_fk
    FOREIGN KEY (organization_id, employee_id)
    REFERENCES employees (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT leave_balances_type_fk
    FOREIGN KEY (organization_id, leave_type_id)
    REFERENCES leave_types (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT leave_balances_year_range CHECK (leave_year BETWEEN 2000 AND 2200),
  CONSTRAINT leave_balances_non_negative
    CHECK (entitled_days >= 0 AND carried_over_days >= 0 AND taken_days >= 0)
);

CREATE TRIGGER leave_balances_set_updated_at
  BEFORE UPDATE ON leave_balances
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enable_tenant_rls('leave_balances');

-- ---------------------------------------------------- training courses ----
CREATE TABLE training_courses (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  code            text NOT NULL,
  name            text NOT NULL,
  description     text,
  category        text NOT NULL DEFAULT 'general',
  -- Biosecurity and safety training expires and must be retaken; an induction
  -- does not. NULL means it never expires.
  validity_months integer,
  is_mandatory    boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT training_courses_code_unique_per_org UNIQUE (organization_id, code),
  CONSTRAINT training_courses_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT training_courses_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT training_courses_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT training_courses_category_check
    CHECK (category IN ('general', 'safety', 'biosecurity', 'technical',
                        'compliance', 'induction', 'management')),
  CONSTRAINT training_courses_validity_range
    CHECK (validity_months IS NULL OR validity_months BETWEEN 1 AND 600)
);

CREATE TRIGGER training_courses_set_updated_at
  BEFORE UPDATE ON training_courses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enable_tenant_rls('training_courses');

-- ----------------------------------------------------- training records ----
CREATE TABLE training_records (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  employee_id        uuid NOT NULL,
  course_id          uuid NOT NULL,
  province_id        uuid,
  site_id            uuid,
  completed_on       date NOT NULL,
  -- Computed from the course's validity at completion time, then stored: if the
  -- policy changes later, a certificate already issued does not silently move.
  expires_on         date,
  result             text NOT NULL DEFAULT 'passed',
  score              numeric(5,2),
  trainer            text,
  certificate_number text,
  notes              text,
  recorded_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT training_records_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT training_records_employee_fk
    FOREIGN KEY (organization_id, employee_id)
    REFERENCES employees (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT training_records_course_fk
    FOREIGN KEY (organization_id, course_id)
    REFERENCES training_courses (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT training_records_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL (province_id),
  CONSTRAINT training_records_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE SET NULL (site_id),
  CONSTRAINT training_records_result_check
    CHECK (result IN ('passed', 'failed', 'attended', 'in_progress')),
  CONSTRAINT training_records_score_range
    CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  CONSTRAINT training_records_expiry_after_completion
    CHECK (expires_on IS NULL OR expires_on >= completed_on),
  CONSTRAINT training_records_trainer_not_blank
    CHECK (trainer IS NULL OR btrim(trainer) <> ''),
  CONSTRAINT training_records_notes_not_blank
    CHECK (notes IS NULL OR btrim(notes) <> '')
);

CREATE TRIGGER training_records_set_updated_at
  BEFORE UPDATE ON training_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX training_records_employee_idx
  ON training_records (organization_id, employee_id, completed_on DESC);
-- Drives the "whose mandatory training has lapsed" report and its alert job.
CREATE INDEX training_records_expiring_idx
  ON training_records (organization_id, expires_on)
  WHERE expires_on IS NOT NULL AND result = 'passed';

SELECT enable_tenant_rls('training_records');

-- ------------------------------------------------ disciplinary actions ----
CREATE TABLE disciplinary_actions (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  employee_id      uuid NOT NULL,
  province_id      uuid,
  site_id          uuid,
  reference        text NOT NULL,
  occurred_on      date NOT NULL,
  reported_on      date NOT NULL DEFAULT CURRENT_DATE,
  category         text NOT NULL,
  severity         text NOT NULL DEFAULT 'minor',
  -- The escalating ladder most labour codes require: you cannot dismiss for a
  -- first minor offence, so the level taken is recorded explicitly.
  action_taken     text NOT NULL DEFAULT 'verbal_warning',
  description      text NOT NULL,
  employee_statement text,
  status           text NOT NULL DEFAULT 'open',
  -- A warning stops counting toward the ladder after a period; without an expiry
  -- an old warning would justify dismissal for ever.
  expires_on       date,
  raised_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT disciplinary_actions_reference_unique_per_org
    UNIQUE (organization_id, reference),
  CONSTRAINT disciplinary_actions_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT disciplinary_actions_employee_fk
    FOREIGN KEY (organization_id, employee_id)
    REFERENCES employees (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT disciplinary_actions_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL (province_id),
  CONSTRAINT disciplinary_actions_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE SET NULL (site_id),
  CONSTRAINT disciplinary_actions_category_check
    CHECK (category IN ('attendance', 'conduct', 'performance', 'safety',
                        'biosecurity', 'theft', 'insubordination', 'other')),
  CONSTRAINT disciplinary_actions_severity_check
    CHECK (severity IN ('minor', 'serious', 'gross')),
  CONSTRAINT disciplinary_actions_action_check
    CHECK (action_taken IN ('none', 'verbal_warning', 'written_warning',
                            'final_warning', 'suspension', 'demotion',
                            'dismissal')),
  CONSTRAINT disciplinary_actions_status_check
    CHECK (status IN ('open', 'under_review', 'upheld', 'dismissed', 'appealed',
                      'closed')),
  CONSTRAINT disciplinary_actions_description_not_blank
    CHECK (btrim(description) <> ''),
  CONSTRAINT disciplinary_actions_reference_format
    CHECK (reference ~ '^[A-Za-z0-9][A-Za-z0-9_/-]{0,62}$'),
  CONSTRAINT disciplinary_actions_reported_after_occurred
    CHECK (reported_on >= occurred_on),
  CONSTRAINT disciplinary_actions_expiry_after_occurred
    CHECK (expires_on IS NULL OR expires_on >= occurred_on)
);

CREATE TRIGGER disciplinary_actions_set_updated_at
  BEFORE UPDATE ON disciplinary_actions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX disciplinary_actions_employee_idx
  ON disciplinary_actions (organization_id, employee_id, occurred_on DESC);
CREATE INDEX disciplinary_actions_open_idx
  ON disciplinary_actions (organization_id, province_id, occurred_on)
  WHERE status IN ('open', 'under_review', 'appealed');

SELECT enable_tenant_rls('disciplinary_actions');

-- ------------------------------------------------ performance reviews ----
CREATE TABLE performance_reviews (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  employee_id       uuid NOT NULL,
  province_id       uuid,
  site_id           uuid,
  -- The period under review, not when the meeting happened.
  period_start      date NOT NULL,
  period_end        date NOT NULL,
  review_type       text NOT NULL DEFAULT 'annual',
  reviewed_on       date,
  -- Kept as a 1-5 numeric so it can be averaged across a department without the
  -- caller having to map labels back to numbers.
  overall_rating    numeric(3,2),
  strengths         text,
  areas_to_improve  text,
  goals             text,
  employee_comments text,
  status            text NOT NULL DEFAULT 'draft',
  reviewer_id       uuid,
  acknowledged_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT performance_reviews_period_unique
    UNIQUE (organization_id, employee_id, period_start, period_end, review_type),
  CONSTRAINT performance_reviews_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT performance_reviews_employee_fk
    FOREIGN KEY (organization_id, employee_id)
    REFERENCES employees (organization_id, id) ON DELETE CASCADE,
  -- The reviewer is an employee too, so this must not cross tenants either.
  CONSTRAINT performance_reviews_reviewer_fk
    FOREIGN KEY (organization_id, reviewer_id)
    REFERENCES employees (organization_id, id) ON DELETE SET NULL (reviewer_id),
  CONSTRAINT performance_reviews_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL (province_id),
  CONSTRAINT performance_reviews_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE SET NULL (site_id),
  CONSTRAINT performance_reviews_type_check
    CHECK (review_type IN ('probation', 'quarterly', 'half_year', 'annual',
                           'promotion', 'exit')),
  CONSTRAINT performance_reviews_status_check
    CHECK (status IN ('draft', 'submitted', 'acknowledged', 'closed')),
  CONSTRAINT performance_reviews_period_check CHECK (period_end >= period_start),
  CONSTRAINT performance_reviews_rating_range
    CHECK (overall_rating IS NULL OR (overall_rating >= 1 AND overall_rating <= 5)),
  -- An employee cannot review themselves.
  CONSTRAINT performance_reviews_reviewer_not_self
    CHECK (reviewer_id IS NULL OR reviewer_id <> employee_id)
);

CREATE TRIGGER performance_reviews_set_updated_at
  BEFORE UPDATE ON performance_reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX performance_reviews_employee_idx
  ON performance_reviews (organization_id, employee_id, period_end DESC);

SELECT enable_tenant_rls('performance_reviews');

COMMENT ON TABLE leave_requests IS
  'Leave requests. The exclusion constraint prevents two approved leaves from overlapping for one employee.';
COMMENT ON TABLE disciplinary_actions IS
  'Disciplinary record. expires_on exists so an old warning stops counting toward the escalation ladder.';
