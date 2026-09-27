-- 113_simplify_document_folder_defaults.sql
-- Start every company with only General, Photo Evidence and Task Evidence.
-- Older standard folders are safely folded into General; no project document is deleted.

BEGIN;

INSERT INTO management_document_categories
  (organization_id, code, name, description, sort_order, is_active, visibility)
SELECT o.id, d.code, d.name, d.description, d.sort_order, true, 'company'
  FROM organizations o
 CROSS JOIN (
   VALUES
     ('general', 'General', 'Documents that do not need a specialised folder.', 10),
     ('photo', 'Photo evidence', 'Photos from the field, site or delivery.', 20),
     ('task_evidence', 'Task Evidence', 'Evidence submitted from assigned work tasks.', 30)
 ) AS d(code, name, description, sort_order)
ON CONFLICT DO NOTHING;

-- Preserve every existing document: the old supplied folders now point to General.
WITH general_folder AS (
  SELECT organization_id, id
    FROM management_document_categories
   WHERE code = 'general'
)
UPDATE management_document_links document_link
   SET document_category_id = general_folder.id
  FROM management_document_categories legacy_folder
  JOIN general_folder
    ON general_folder.organization_id = legacy_folder.organization_id
 WHERE document_link.organization_id = legacy_folder.organization_id
   AND document_link.document_category_id = legacy_folder.id
   AND legacy_folder.code IN (
     'land', 'legal', 'contract', 'procurement', 'invoice', 'receipt',
     'construction', 'equipment', 'poultry', 'pigs', 'agriculture',
     'finance', 'report', 'other'
   );

-- Legacy task evidence gets the same real folder as new evidence.
UPDATE management_document_links document_link
   SET document_category_id = task_evidence.id
  FROM management_document_categories task_evidence
 WHERE task_evidence.organization_id = document_link.organization_id
   AND task_evidence.code = 'task_evidence'
   AND document_link.document_category_id IS NULL
   AND lower(COALESCE(document_link.document_type, '')) = 'task_evidence';

-- These were platform-supplied folders, not company-created folders. They are
-- deleted only after their files were reassigned, so they can be recreated later.
DELETE FROM management_document_categories category
 WHERE category.code IN (
   'land', 'legal', 'contract', 'procurement', 'invoice', 'receipt',
   'construction', 'equipment', 'poultry', 'pigs', 'agriculture',
   'finance', 'report', 'other'
 )
   AND NOT EXISTS (
     SELECT 1
       FROM management_document_links document_link
      WHERE document_link.organization_id = category.organization_id
        AND document_link.document_category_id = category.id
   );

COMMIT;