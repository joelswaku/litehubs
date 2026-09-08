-- 070_training_assignment_versioning.sql
-- New assignments always retain the version that was published when they were created.

CREATE OR REPLACE FUNCTION set_training_assignment_course_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.course_version_id IS NULL THEN
    SELECT current_version_id
      INTO NEW.course_version_id
      FROM training_courses
     WHERE organization_id=NEW.organization_id
       AND id=NEW.course_id;
  END IF;
  IF NEW.course_version_id IS NULL THEN
    RAISE EXCEPTION 'A published course version is required for a training assignment';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS training_assignments_set_course_version ON training_assignments;
CREATE TRIGGER training_assignments_set_course_version
  BEFORE INSERT ON training_assignments
  FOR EACH ROW EXECUTE FUNCTION set_training_assignment_course_version();