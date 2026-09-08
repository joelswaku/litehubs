-- Training assessments can be self-contained lessons: they do not need an
-- external link or file.  A composite key also prevents a course in one
-- company from ever pointing at a document owned by another company.

ALTER TABLE training_materials
  DROP CONSTRAINT IF EXISTS training_materials_url_or_document;

ALTER TABLE training_materials
  ADD CONSTRAINT training_materials_content_or_assessment
  CHECK (
    external_url IS NOT NULL
    OR document_id IS NOT NULL
    OR (
      material_type = 'assessment'
      AND quiz_questions IS NOT NULL
      AND jsonb_array_length(quiz_questions) > 0
    )
  );

ALTER TABLE training_materials
  ADD CONSTRAINT training_materials_document_tenant_fk
  FOREIGN KEY (organization_id, document_id)
  REFERENCES documents (organization_id, id)
  ON DELETE SET NULL (document_id)
  NOT VALID;