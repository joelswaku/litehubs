-- 054_project_document_categories.sql
-- Company-managed document folders. A category label can be renamed without
-- moving the original file or breaking its task/project links.

BEGIN;

CREATE TABLE management_document_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by_member_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_document_categories_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_document_categories_code_unique UNIQUE (organization_id, code),
  CONSTRAINT management_document_categories_name_unique UNIQUE (organization_id, name),
  CONSTRAINT management_document_categories_code_check CHECK (code ~ '^[a-z0-9][a-z0-9_-]{0,78}$'),
  CONSTRAINT management_document_categories_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT management_document_categories_member_fk
    FOREIGN KEY (organization_id, created_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL
);
CREATE INDEX management_document_categories_active_idx
  ON management_document_categories (organization_id, is_active, sort_order, name);
SELECT enable_tenant_rls('management_document_categories');

ALTER TABLE management_document_links
  ADD COLUMN document_category_id uuid,
  ADD CONSTRAINT management_document_links_category_fk
    FOREIGN KEY (organization_id, document_category_id)
    REFERENCES management_document_categories (organization_id, id) ON DELETE SET NULL;
CREATE INDEX management_document_links_category_idx
  ON management_document_links (organization_id, project_id, document_category_id)
  WHERE document_category_id IS NOT NULL;

-- Give every existing company a professional initial folder structure.
INSERT INTO management_document_categories (organization_id, code, name, sort_order)
SELECT o.id, d.code, d.name, d.sort_order
  FROM organizations o
 CROSS JOIN (
   VALUES
     ('land', 'Land', 10),
     ('legal', 'Legal', 20),
     ('contract', 'Contract', 30),
     ('procurement', 'Procurement', 40),
     ('invoice', 'Invoice', 50),
     ('receipt', 'Receipt', 60),
     ('construction', 'Construction', 70),
     ('equipment', 'Equipment', 80),
     ('poultry', 'Poultry', 90),
     ('pigs', 'Pigs', 100),
     ('agriculture', 'Agriculture', 110),
     ('finance', 'Finance', 120),
     ('report', 'Report', 130),
     ('photo', 'Photo evidence', 140),
     ('other', 'Other', 999)
 ) AS d(code, name, sort_order)
ON CONFLICT (organization_id, code) DO NOTHING;

-- Existing document_type values continue working; link the known ones to their
-- new folders. Unknown legacy labels remain visible in a Legacy folder.
UPDATE management_document_links d
   SET document_category_id = c.id
  FROM management_document_categories c
 WHERE c.organization_id = d.organization_id
   AND d.document_category_id IS NULL
   AND lower(d.document_type) = c.code;

COMMENT ON TABLE management_document_categories IS
  'Tenant-scoped, owner-managed document folders for project and operational files.';

COMMIT;