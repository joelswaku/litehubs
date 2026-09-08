-- Give project assignments their own immutable record identifier. The original
-- natural key remains unique, while API clients can safely address one
-- assignment without putting two identifiers into a URL.

ALTER TABLE management_project_members
  ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE management_project_members DROP CONSTRAINT management_project_members_pkey;
ALTER TABLE management_project_members ADD CONSTRAINT management_project_members_pkey PRIMARY KEY (id);
ALTER TABLE management_project_members
  ADD CONSTRAINT management_project_members_project_member_unique UNIQUE (project_id, member_id);
CREATE INDEX management_project_members_project_idx ON management_project_members (organization_id, project_id);
