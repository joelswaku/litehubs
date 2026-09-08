BEGIN;

-- A project may be drafted before it is funded and its target date may be
-- revised without overwriting the original plan or the real completion date.
ALTER TABLE management_projects
  ADD COLUMN revised_completion_date date,
  ADD COLUMN funding_source text,
  ADD COLUMN expected_outcome text,
  ADD COLUMN approval_required boolean NOT NULL DEFAULT false;

ALTER TABLE management_projects
  DROP CONSTRAINT management_projects_status_check,
  ADD CONSTRAINT management_projects_status_check CHECK (status IN (
    'draft', 'planning', 'pending_approval', 'approved', 'in_progress',
    'on_hold', 'completed', 'cancelled'
  )),
  DROP CONSTRAINT management_projects_type_check,
  ADD CONSTRAINT management_projects_type_check CHECK (project_type IN (
    'land', 'construction', 'expansion', 'infrastructure', 'equipment',
    'livestock', 'housing', 'technology', 'maintenance', 'mixed_investment',
    'other'
  )),
  DROP CONSTRAINT management_projects_dates_check,
  ADD CONSTRAINT management_projects_dates_check CHECK (
    (target_completion_date IS NULL OR start_date IS NULL OR target_completion_date >= start_date) AND
    (revised_completion_date IS NULL OR start_date IS NULL OR revised_completion_date >= start_date) AND
    (completed_date IS NULL OR start_date IS NULL OR completed_date >= start_date)
  ),
  DROP CONSTRAINT management_projects_text_check,
  ADD CONSTRAINT management_projects_text_check CHECK (
    btrim(name) <> '' AND
    (description IS NULL OR btrim(description) <> '') AND
    (blueprint IS NULL OR btrim(blueprint) <> '') AND
    (funding_source IS NULL OR btrim(funding_source) <> '') AND
    (expected_outcome IS NULL OR btrim(expected_outcome) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  );

-- A phase keeps the planned dates and the date work actually started. Its real
-- finish remains completed_date, preserving all existing historical records.
ALTER TABLE management_project_phases
  ADD COLUMN actual_start_date date;

ALTER TABLE management_project_phases
  DROP CONSTRAINT management_project_phases_dates_check,
  ADD CONSTRAINT management_project_phases_dates_check CHECK (
    (target_end_date IS NULL OR start_date IS NULL OR target_end_date >= start_date) AND
    (completed_date IS NULL OR start_date IS NULL OR completed_date >= start_date) AND
    (completed_date IS NULL OR actual_start_date IS NULL OR completed_date >= actual_start_date)
  );

-- Dependencies are explicit and immutable once created. This makes a phase
-- wait for its prerequisite rather than relying on an informal note.
CREATE TABLE management_project_phase_dependencies (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  phase_id              uuid NOT NULL,
  depends_on_phase_id   uuid NOT NULL,
  dependency_type       text NOT NULL DEFAULT 'finish_to_start',
  created_by_member_id  uuid REFERENCES organization_members (id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_project_phase_dependencies_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_project_phase_dependencies_unique UNIQUE (organization_id, phase_id, depends_on_phase_id),
  CONSTRAINT management_project_phase_dependencies_phase_fk FOREIGN KEY (organization_id, phase_id)
    REFERENCES management_project_phases (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT management_project_phase_dependencies_dependency_fk FOREIGN KEY (organization_id, depends_on_phase_id)
    REFERENCES management_project_phases (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT management_project_phase_dependencies_not_self CHECK (phase_id <> depends_on_phase_id),
  CONSTRAINT management_project_phase_dependencies_type_check CHECK (dependency_type IN (
    'finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish'
  ))
);
CREATE INDEX management_project_phase_dependencies_phase_idx
  ON management_project_phase_dependencies (organization_id, phase_id);
SELECT enable_tenant_rls('management_project_phase_dependencies');

COMMENT ON COLUMN management_projects.revised_completion_date IS 'Owner-approved revised target date; the original target is preserved.';
COMMENT ON TABLE management_project_phase_dependencies IS 'Prerequisite relationships between phases of the same project.';

COMMIT;