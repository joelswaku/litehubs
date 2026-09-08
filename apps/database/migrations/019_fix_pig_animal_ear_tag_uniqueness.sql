-- Allow any number of animals without an ear tag, while still preventing
-- duplicate non-empty ear tags within the same organization.
ALTER TABLE pig_animals
  DROP CONSTRAINT pig_animals_ear_tag_unique;

CREATE UNIQUE INDEX pig_animals_org_ear_tag_unique
  ON pig_animals (organization_id, ear_tag)
  WHERE ear_tag IS NOT NULL;
