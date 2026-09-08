-- 039_project_operational_links.sql
-- Links a capital project to the real operational record created by it.
-- It never copies poultry, pigs, or agriculture data into Projects.

CREATE TABLE management_project_operational_links (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id            uuid NOT NULL,
  module_code           text NOT NULL,
  resource_code         text NOT NULL,
  record_id             uuid NOT NULL,
  link_type             text NOT NULL DEFAULT 'created_by_project',
  notes                 text,
  linked_by_member_id   uuid REFERENCES organization_members (id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_project_operational_links_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_project_operational_links_project_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES management_projects (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_project_operational_links_unique
    UNIQUE (organization_id, project_id, module_code, resource_code, record_id),
  CONSTRAINT management_project_operational_links_module_check
    CHECK (module_code IN ('poultry', 'pigs', 'agriculture')),
  CONSTRAINT management_project_operational_links_type_check
    CHECK (link_type IN ('created_by_project', 'acquired_for_project', 'built_for_project', 'assigned_to_project', 'land_acquisition')),
  CONSTRAINT management_project_operational_links_notes_check
    CHECK (notes IS NULL OR btrim(notes) <> '')
);

CREATE INDEX management_project_operational_links_project_idx
  ON management_project_operational_links (organization_id, project_id, created_at DESC);
CREATE INDEX management_project_operational_links_record_idx
  ON management_project_operational_links (organization_id, module_code, resource_code, record_id);
SELECT enable_tenant_rls('management_project_operational_links');

COMMENT ON TABLE management_project_operational_links IS
  'A tenant-safe, non-duplicating link from an investment project to Poultry, Pigs, or Agriculture records.';
