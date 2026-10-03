BEGIN;

-- Keep author references inside their owning company.  These columns are
-- nullable because a former member can be removed while the published record
-- remains, but an existing author can never belong to another organization.
ALTER TABLE company_rules_versions
  DROP CONSTRAINT IF EXISTS company_rules_versions_created_by_member_id_fkey,
  ADD CONSTRAINT company_rules_versions_created_by_member_fk
    FOREIGN KEY (organization_id, created_by_member_id)
    REFERENCES organization_members (organization_id, id)
    ON DELETE SET NULL (created_by_member_id);

ALTER TABLE organization_website_settings
  DROP CONSTRAINT IF EXISTS organization_website_settings_created_by_member_id_fkey,
  DROP CONSTRAINT IF EXISTS organization_website_settings_updated_by_member_id_fkey,
  ADD CONSTRAINT organization_website_settings_created_by_member_fk
    FOREIGN KEY (organization_id, created_by_member_id)
    REFERENCES organization_members (organization_id, id)
    ON DELETE SET NULL (created_by_member_id),
  ADD CONSTRAINT organization_website_settings_updated_by_member_fk
    FOREIGN KEY (organization_id, updated_by_member_id)
    REFERENCES organization_members (organization_id, id)
    ON DELETE SET NULL (updated_by_member_id);

ALTER TABLE organization_website_pages
  DROP CONSTRAINT IF EXISTS organization_website_pages_created_by_member_id_fkey,
  DROP CONSTRAINT IF EXISTS organization_website_pages_updated_by_member_id_fkey,
  ADD CONSTRAINT organization_website_pages_created_by_member_fk
    FOREIGN KEY (organization_id, created_by_member_id)
    REFERENCES organization_members (organization_id, id)
    ON DELETE SET NULL (created_by_member_id),
  ADD CONSTRAINT organization_website_pages_updated_by_member_fk
    FOREIGN KEY (organization_id, updated_by_member_id)
    REFERENCES organization_members (organization_id, id)
    ON DELETE SET NULL (updated_by_member_id);

ALTER TABLE organization_website_media
  DROP CONSTRAINT IF EXISTS organization_website_media_created_by_member_id_fkey,
  ADD CONSTRAINT organization_website_media_created_by_member_fk
    FOREIGN KEY (organization_id, created_by_member_id)
    REFERENCES organization_members (organization_id, id)
    ON DELETE SET NULL (created_by_member_id);

-- Rotated public-account sessions may only point to a replacement session in
-- the same organization.  The composite candidate key is also required by the
-- database to enforce that relationship.
ALTER TABLE public_customer_refresh_tokens
  ADD CONSTRAINT public_customer_refresh_tokens_org_id_unique
    UNIQUE (organization_id, id);
ALTER TABLE public_customer_refresh_tokens
  DROP CONSTRAINT IF EXISTS public_customer_refresh_tokens_replaced_by_id_fkey,
  ADD CONSTRAINT public_customer_refresh_tokens_replaced_by_fk
    FOREIGN KEY (organization_id, replaced_by_id)
    REFERENCES public_customer_refresh_tokens (organization_id, id)
    ON DELETE SET NULL (replaced_by_id);

COMMIT;
