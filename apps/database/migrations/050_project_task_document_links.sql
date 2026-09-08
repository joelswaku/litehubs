-- Reusable project-document associations. A file remains one project document and
-- may be referenced by several tasks without being copied or deleted on unlink.

CREATE TABLE management_project_task_document_links (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id          uuid NOT NULL,
  task_id             uuid NOT NULL,
  phase_id            uuid,
  document_id         uuid NOT NULL,
  linked_by_member_id uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_project_task_document_links_org_id_unique
    UNIQUE (organization_id, id),
  CONSTRAINT management_project_task_document_links_unique
    UNIQUE (organization_id, task_id, document_id),
  CONSTRAINT management_project_task_document_links_project_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES management_projects (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT management_project_task_document_links_task_fk
    FOREIGN KEY (organization_id, task_id)
    REFERENCES management_project_tasks (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT management_project_task_document_links_phase_fk
    FOREIGN KEY (organization_id, phase_id)
    REFERENCES management_project_phases (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_project_task_document_links_document_fk
    FOREIGN KEY (organization_id, document_id)
    REFERENCES management_document_links (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_project_task_document_links_member_fk
    FOREIGN KEY (organization_id, linked_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL
);

CREATE INDEX management_project_task_document_links_task_idx
  ON management_project_task_document_links (organization_id, task_id, created_at DESC);
CREATE INDEX management_project_task_document_links_document_idx
  ON management_project_task_document_links (organization_id, document_id, created_at DESC);
SELECT enable_tenant_rls('management_project_task_document_links');

COMMENT ON TABLE management_project_task_document_links IS
  'Many-to-many links between a reusable project document and project task; unlinking keeps the original project file.';