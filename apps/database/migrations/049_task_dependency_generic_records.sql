-- Task dependencies are consumed by the generic owner-management API.
-- The original composite key protected duplicate links, but the API also needs
-- one stable UUID for visibility checks, audit history and list ordering.
-- Keep the existing composite primary key intact and add the generic identity.

ALTER TABLE management_task_dependencies
  ADD COLUMN IF NOT EXISTS id uuid;

UPDATE management_task_dependencies
  SET id = gen_random_uuid()
  WHERE id IS NULL;

ALTER TABLE management_task_dependencies
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS management_task_dependencies_org_id_unique
  ON management_task_dependencies (organization_id, id);

ALTER TABLE management_task_dependencies
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

UPDATE management_task_dependencies
  SET created_at = now()
  WHERE created_at IS NULL;

ALTER TABLE management_task_dependencies
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL;