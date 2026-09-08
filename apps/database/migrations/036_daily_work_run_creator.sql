-- 036_daily_work_run_creator.sql
-- A checklist starts before it is completed. Keep its creator so an employee
-- with self scope can return to their own in-progress run without seeing other
-- teams' operational records.

ALTER TABLE checklist_runs
  ADD COLUMN created_by_member_id uuid;

ALTER TABLE checklist_runs
  ADD CONSTRAINT checklist_runs_created_by_member_fk
  FOREIGN KEY (organization_id, created_by_member_id)
  REFERENCES organization_members (organization_id, id)
  ON DELETE SET NULL;

CREATE INDEX checklist_runs_creator_date_idx
  ON checklist_runs (organization_id, created_by_member_id, work_date DESC)
  WHERE created_by_member_id IS NOT NULL;