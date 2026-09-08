-- Professional contract workspace: templates, immutable versions and multi-field e-signatures.
CREATE TABLE contract_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  contract_type text NOT NULL,
  language text NOT NULL DEFAULT 'fr',
  body jsonb NOT NULL DEFAULT '{"blocks":[]}'::jsonb,
  merge_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_templates_org_code_unique UNIQUE (organization_id, code),
  CONSTRAINT contract_templates_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT contract_templates_code_format CHECK (code ~ '^[a-z0-9][a-z0-9_-]{1,62}$'),
  CONSTRAINT contract_templates_body_object CHECK (jsonb_typeof(body)='object'),
  CONSTRAINT contract_templates_fields_array CHECK (jsonb_typeof(merge_fields)='array')
);
CREATE TRIGGER contract_templates_set_updated_at BEFORE UPDATE ON contract_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX contract_templates_active_idx ON contract_templates(organization_id, contract_type) WHERE is_active;
SELECT enable_tenant_rls('contract_templates');

CREATE TABLE contract_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL,
  version_number integer NOT NULL,
  template_id uuid,
  source_document_id uuid,
  rendered_document_id uuid,
  final_document_id uuid,
  status text NOT NULL DEFAULT 'draft',
  rendered_content jsonb NOT NULL DEFAULT '{"blocks":[]}'::jsonb,
  document_hash_sha256 text,
  frozen_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_versions_org_contract_fk FOREIGN KEY (organization_id, contract_id) REFERENCES contracts(organization_id,id) ON DELETE CASCADE,
  CONSTRAINT contract_versions_template_fk FOREIGN KEY (organization_id, template_id) REFERENCES contract_templates(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT contract_versions_source_doc_fk FOREIGN KEY (organization_id, source_document_id) REFERENCES documents(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT contract_versions_rendered_doc_fk FOREIGN KEY (organization_id, rendered_document_id) REFERENCES documents(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT contract_versions_final_doc_fk FOREIGN KEY (organization_id, final_document_id) REFERENCES documents(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT contract_versions_unique_number UNIQUE(organization_id,contract_id,version_number),
  CONSTRAINT contract_versions_org_id_unique UNIQUE(organization_id,id),
  CONSTRAINT contract_versions_status CHECK(status IN ('draft','ready_for_signature','awaiting_employee_signature','awaiting_employer_signature','signed','active','rejected','expired','cancelled')),
  CONSTRAINT contract_versions_content_object CHECK(jsonb_typeof(rendered_content)='object')
);
CREATE INDEX contract_versions_current_idx ON contract_document_versions(organization_id,contract_id,version_number DESC);
SELECT enable_tenant_rls('contract_document_versions');

CREATE TABLE contract_signature_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version_id uuid NOT NULL,
  signer_role text NOT NULL,
  label text NOT NULL,
  page_number integer NOT NULL DEFAULT 1,
  x numeric(8,2) NOT NULL,
  y numeric(8,2) NOT NULL,
  width numeric(8,2) NOT NULL DEFAULT 180,
  height numeric(8,2) NOT NULL DEFAULT 48,
  field_order integer NOT NULL DEFAULT 1,
  is_required boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending',
  signed_by_member_id uuid,
  signed_name text,
  signature_method text,
  signature_data text,
  consent_text text,
  signed_at timestamptz,
  CONSTRAINT contract_signature_fields_org_id_unique UNIQUE(organization_id,id),
  CONSTRAINT contract_signature_fields_version_fk FOREIGN KEY(organization_id,version_id) REFERENCES contract_document_versions(organization_id,id) ON DELETE CASCADE,
  CONSTRAINT contract_signature_fields_member_fk FOREIGN KEY(organization_id,signed_by_member_id) REFERENCES organization_members(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT contract_signature_fields_role CHECK(signer_role IN ('employee','employer')),
  CONSTRAINT contract_signature_fields_position CHECK(page_number > 0 AND x >= 0 AND y >= 0 AND width > 0 AND height > 0),
  CONSTRAINT contract_signature_fields_status CHECK(status IN ('pending','signed','rejected')),
  CONSTRAINT contract_signature_fields_method CHECK(signature_method IS NULL OR signature_method IN ('typed','drawn','uploaded')),
  CONSTRAINT contract_signature_fields_signed_complete CHECK(signed_at IS NULL OR (signed_by_member_id IS NOT NULL AND btrim(COALESCE(signed_name,''))<>'' AND signature_method IS NOT NULL AND btrim(COALESCE(consent_text,''))<>''))
);
CREATE INDEX contract_signature_fields_pending_idx ON contract_signature_fields(organization_id,version_id,signer_role,field_order) WHERE status='pending';
SELECT enable_tenant_rls('contract_signature_fields');

CREATE TABLE contract_signature_events (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL,
  version_id uuid,
  signature_field_id uuid,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_member_id uuid,
  event_type text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_signature_events_contract_fk FOREIGN KEY(organization_id,contract_id) REFERENCES contracts(organization_id,id) ON DELETE CASCADE,
  CONSTRAINT contract_signature_events_version_fk FOREIGN KEY(organization_id,version_id) REFERENCES contract_document_versions(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT contract_signature_events_field_fk FOREIGN KEY(organization_id,signature_field_id) REFERENCES contract_signature_fields(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT contract_signature_events_detail_object CHECK(jsonb_typeof(detail)='object')
);
CREATE INDEX contract_signature_events_timeline_idx ON contract_signature_events(organization_id,contract_id,created_at DESC);
SELECT enable_tenant_rls('contract_signature_events');

ALTER TABLE contracts DROP CONSTRAINT contracts_status_check;
ALTER TABLE contracts ADD CONSTRAINT contracts_status_check CHECK(status IN ('draft','pending_signature','ready_for_signature','awaiting_employee_signature','awaiting_employer_signature','signed','active','rejected','expired','terminated','renewed','cancelled'));