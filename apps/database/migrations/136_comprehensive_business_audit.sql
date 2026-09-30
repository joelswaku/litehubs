-- 136_comprehensive_business_audit.sql
--
-- A company audit trail cannot depend on each screen remembering to call an
-- application helper.  This migration adds one transaction-local trigger for
-- the business records that are not already handled by Owner Management's
-- explicit audit writer.  If the business write rolls back, the audit entry
-- rolls back with it; if it commits, the evidence commits with it.

-- The API pins these values with SET LOCAL in tenant-query.ts.  They are empty
-- for background work, in which case the log deliberately shows "System".
CREATE OR REPLACE FUNCTION audit_current_member_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('app.member_id', true), '')::uuid
$$;

-- Audit views must be useful without exposing passwords, reset tokens,
-- document locations, contact details, free-text notes or long narrative
-- fields.  The source record remains the authoritative private record.
CREATE OR REPLACE FUNCTION audit_safe_snapshot(source_row jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
    FROM jsonb_each(COALESCE(source_row, '{}'::jsonb))
   WHERE key NOT IN ('id', 'organization_id', 'created_at', 'updated_at')
     AND key !~* '(password|token|secret|hash|signature|storage|file_path|file_key|url|email|phone|address|notes|description|content|body|ip_)'
$$;

CREATE OR REPLACE FUNCTION audit_entity_label(source_row jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
    left(
      COALESCE(
        NULLIF(btrim(source_row ->> 'name'), ''),
        NULLIF(btrim(source_row ->> 'title'), ''),
        NULLIF(btrim(source_row ->> 'full_name'), ''),
        NULLIF(btrim(source_row ->> 'code'), ''),
        NULLIF(btrim(source_row ->> 'project_code'), ''),
        NULLIF(btrim(source_row ->> 'task_code'), ''),
        NULLIF(btrim(source_row ->> 'request_number'), ''),
        NULLIF(btrim(source_row ->> 'order_number'), ''),
        NULLIF(btrim(source_row ->> 'receipt_number'), ''),
        NULLIF(btrim(source_row ->> 'invoice_number'), ''),
        NULLIF(btrim(source_row ->> 'employee_number'), ''),
        NULLIF(btrim(source_row ->> 'asset_number'), ''),
        NULLIF(btrim(source_row ->> 'reference_number'), ''),
        NULLIF(btrim(source_row ->> 'label'), ''),
        NULLIF(btrim(source_row ->> 'status'), '')
      ),
      240
    ),
    ''
  )
$$;

CREATE OR REPLACE FUNCTION audit_uuid_or_null(value text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN value::uuid
    ELSE NULL
  END
$$;

-- Kept in SQL so API filtering and the PDF export use the exact same areas.
CREATE OR REPLACE FUNCTION audit_log_area(table_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN table_name LIKE 'management_project%' OR table_name LIKE 'management_purchase%' OR table_name LIKE 'management_receipt%' OR table_name LIKE 'management_expense%' OR table_name LIKE 'management_approval%' THEN 'projects'
    WHEN table_name LIKE 'management_asset%' OR table_name LIKE 'management_vehicle%' OR table_name LIKE 'management_maintenance%' OR table_name LIKE 'management_inventory%' OR table_name LIKE 'management_warehouse%' OR table_name LIKE 'management_material%' THEN 'operations'
    WHEN table_name LIKE 'poultry_%' THEN 'poultry'
    WHEN table_name LIKE 'pig_%' THEN 'pigs'
    WHEN table_name LIKE 'agriculture_%' THEN 'agriculture'
    WHEN table_name LIKE 'nutrition_%' THEN 'nutrition'
    WHEN table_name LIKE 'sales_%' OR table_name IN ('customers', 'customer_payments', 'payment_allocations', 'credit_notes') THEN 'sales'
    WHEN table_name LIKE 'finance_%' THEN 'finance'
    WHEN table_name IN ('employees', 'shifts', 'shift_assignments', 'shift_assignment_exceptions', 'attendance_records', 'leave_types', 'leave_requests', 'disciplinary_actions', 'performance_reviews', 'performance_review_goals') OR table_name LIKE 'payroll_%' OR table_name LIKE 'payslip%' OR table_name LIKE 'employee_%' THEN 'people'
    WHEN table_name LIKE 'training_%' THEN 'training'
    WHEN table_name IN ('documents', 'contracts', 'contract_templates', 'contract_document_versions', 'contract_signature_fields', 'contract_signature_events') THEN 'documents'
    WHEN table_name LIKE 'security_%' OR table_name IN ('incidents', 'critical_controls', 'alerts', 'corrective_actions', 'escalations') THEN 'security'
    WHEN table_name LIKE 'appointment_%' OR table_name IN ('appointments', 'appointment_events', 'appointment_messages') THEN 'appointments'
    WHEN table_name LIKE 'career_%' THEN 'recruitment'
    WHEN table_name IN ('organizations', 'users', 'roles', 'role_permissions', 'member_roles', 'member_provinces', 'organization_members', 'organization_invitations', 'organization_invitation_provinces', 'organization_settings', 'provinces', 'sites', 'departments', 'notification_preferences', 'notification_profile_preferences') THEN 'access'
    WHEN table_name LIKE 'checklist_%' OR table_name IN ('daily_reports', 'shift_handovers', 'report_definitions', 'report_runs') THEN 'daily_work'
    ELSE 'other'
  END
$$;

CREATE OR REPLACE FUNCTION audit_business_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  before_row jsonb;
  after_row jsonb;
  before_safe jsonb;
  after_safe jsonb;
  change_fields text[];
  changed_before jsonb;
  changed_after jsonb;
  actor_email text;
  actor_name text;
  actor_member_id uuid;
  operation text;
  level text := 'info';
  entity_identifier uuid;
  entity_label text;
  organization_identifier uuid;
  next_status text;
BEGIN
  before_row := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  after_row := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  organization_identifier := audit_uuid_or_null(COALESCE(after_row ->> 'organization_id', before_row ->> 'organization_id'));

  -- organizations is the one tenant record whose key is `id` rather than
  -- `organization_id`. Only audit it when the transaction is already scoped
  -- to that same workspace; provisioning remains free to create its initial
  -- system records without creating misleading user evidence.
  IF organization_identifier IS NULL
     AND TG_TABLE_NAME = 'organizations'
     AND current_organization_id() = audit_uuid_or_null(COALESCE(after_row ->> 'id', before_row ->> 'id')) THEN
    organization_identifier := current_organization_id();
  END IF;

  -- Do not create ambiguous evidence if a legacy/non-tenant row somehow has
  -- no organization. All registered tables below are tenant tables.
  IF organization_identifier IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  before_safe := audit_safe_snapshot(before_row);
  after_safe := audit_safe_snapshot(after_row);
  entity_identifier := audit_uuid_or_null(COALESCE(after_row ->> 'id', before_row ->> 'id'));
  entity_label := audit_entity_label(COALESCE(NULLIF(after_row, '{}'::jsonb), before_row));

  IF TG_OP = 'INSERT' THEN
    operation := 'create';
    change_fields := ARRAY(SELECT key FROM jsonb_object_keys(after_safe) AS fields(key) ORDER BY key);
  ELSIF TG_OP = 'DELETE' THEN
    operation := 'delete';
    level := 'warning';
    change_fields := ARRAY(SELECT key FROM jsonb_object_keys(before_safe) AS fields(key) ORDER BY key);
  ELSE
    SELECT COALESCE(array_agg(key ORDER BY key), ARRAY[]::text[]),
           COALESCE(jsonb_object_agg(key, before_safe -> key), '{}'::jsonb),
           COALESCE(jsonb_object_agg(key, after_safe -> key), '{}'::jsonb)
      INTO change_fields, changed_before, changed_after
      FROM (
        SELECT key
          FROM jsonb_object_keys(before_safe || after_safe) AS fields(key)
         WHERE (before_safe -> key) IS DISTINCT FROM (after_safe -> key)
      ) changed;

    -- `updated_at` and a no-op upsert are not business actions.
    IF cardinality(change_fields) = 0 THEN
      RETURN NEW;
    END IF;

    next_status := lower(COALESCE(after_row ->> 'status', ''));
    operation := CASE
      WHEN next_status IN ('approved', 'verified', 'accepted') THEN 'approve'
      WHEN next_status IN ('rejected', 'refused') THEN 'reject'
      WHEN next_status IN ('cancelled', 'void', 'voided') THEN 'cancel'
      WHEN next_status IN ('reversed', 'refunded') THEN 'reverse'
      ELSE 'update'
    END;
    IF operation IN ('reject', 'cancel', 'reverse') THEN
      level := 'warning';
    END IF;
  END IF;

  IF TG_TABLE_NAME IN ('roles', 'role_permissions', 'member_roles', 'member_provinces', 'organization_members', 'organization_invitations', 'organization_invitation_provinces') THEN
    level := CASE WHEN operation IN ('delete', 'cancel') THEN 'critical' ELSE 'notice' END;
  ELSIF TG_TABLE_NAME IN ('finance_journal_entries', 'finance_cash_movements', 'finance_supplier_payments', 'customer_payments', 'payroll_runs', 'payslips', 'sales_invoices') THEN
    level := CASE WHEN operation IN ('delete', 'cancel', 'reverse') THEN 'critical' ELSE 'notice' END;
  END IF;

  actor_member_id := audit_current_member_id();
  -- A stale or background member reference must never block the business
  -- transaction. The copied name/email still makes the event intelligible.
  IF actor_member_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM organization_members member
     WHERE member.organization_id = organization_identifier AND member.id = actor_member_id
  ) THEN
    actor_member_id := NULL;
  END IF;

  SELECT email, full_name INTO actor_email, actor_name
    FROM users WHERE id = current_user_id();

  INSERT INTO audit_log (
    organization_id, user_id, member_id, actor_email, actor_name,
    action, entity_table, entity_id, entity_label, changes, severity
  ) VALUES (
    organization_identifier, current_user_id(), actor_member_id, actor_email,
    COALESCE(actor_name, 'System'), operation, TG_TABLE_NAME, entity_identifier,
    entity_label,
    CASE
      WHEN TG_OP = 'UPDATE' THEN jsonb_build_object(
        'event', 'updated', 'area', audit_log_area(TG_TABLE_NAME),
        'fields', to_jsonb(change_fields), 'before', changed_before, 'after', changed_after
      )
      WHEN TG_OP = 'INSERT' THEN jsonb_build_object(
        'event', 'created', 'area', audit_log_area(TG_TABLE_NAME),
        'fields', to_jsonb(change_fields)
      )
      ELSE jsonb_build_object(
        'event', 'deleted', 'area', audit_log_area(TG_TABLE_NAME),
        'fields', to_jsonb(change_fields)
      )
    END,
    level
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION audit_business_change() IS
  'Writes immutable, privacy-safe business audit events in the same transaction as the changed record.';

-- Owner Management already writes richer audit events itself, including
-- project budget evidence, approvals and stock transfer pairs. Keeping that
-- writer avoids duplicate project events. These triggers cover the rest of
-- the platform: people, production, sales, finance, documents, security,
-- training, appointments and daily work.
DO $$
DECLARE
  audited_tables text[] := ARRAY[
    'organizations', 'organization_settings', 'provinces', 'sites', 'departments',
    'roles', 'role_permissions', 'member_roles', 'member_provinces',
    'organization_members', 'organization_invitations', 'organization_invitation_provinces',
    'employees', 'shifts', 'shift_assignments', 'shift_assignment_exceptions', 'attendance_records',
    'leave_types', 'leave_requests', 'disciplinary_actions', 'performance_reviews', 'performance_review_goals',
    'payroll_components', 'employee_compensation', 'employee_payroll_components', 'payroll_runs', 'payslips',
    'documents', 'contracts', 'contract_templates', 'contract_document_versions', 'contract_signature_fields', 'contract_signature_events',
    'incidents', 'security_visitors', 'security_asset_movements', 'security_keys', 'security_key_handovers',
    'checklist_templates', 'checklist_template_items', 'checklist_runs', 'checklist_responses', 'daily_reports', 'shift_handovers', 'report_definitions', 'report_runs',
    'poultry_houses', 'poultry_flocks', 'poultry_daily_records', 'poultry_mortality_records', 'poultry_feed_records', 'poultry_water_records', 'poultry_weight_records', 'poultry_egg_records', 'poultry_health_records', 'poultry_vaccination_records', 'poultry_treatment_records', 'poultry_sanitation_records', 'poultry_biosecurity_records', 'poultry_loss_records', 'poultry_performance_models', 'poultry_model_vaccine_schedules',
    'pig_pens', 'pig_groups', 'pig_animals', 'pig_daily_records', 'pig_feed_records', 'pig_water_records', 'pig_weight_records', 'pig_movements', 'pig_mortality_records', 'pig_loss_records', 'pig_breeding_records', 'pig_pregnancies', 'pig_farrowing_records', 'pig_piglets', 'pig_health_records', 'pig_vaccination_records', 'pig_treatment_records', 'pig_quarantine_records', 'pig_veterinary_records',
    'agriculture_farms', 'agriculture_fields', 'agriculture_plots', 'agriculture_crops', 'agriculture_seasons', 'agriculture_plantings', 'agriculture_operations', 'agriculture_irrigation_records', 'agriculture_fertilizer_records', 'agriculture_pesticide_records', 'agriculture_scouting_records', 'agriculture_weather_records', 'agriculture_harvest_records', 'agriculture_loss_records',
    'customers', 'sales_orders', 'sales_order_lines', 'sales_deliveries', 'sales_delivery_lines', 'sales_invoices', 'sales_invoice_lines', 'customer_payments', 'payment_allocations', 'credit_notes', 'sales_operational_offers',
    'finance_accounts', 'finance_periods', 'finance_journal_entries', 'finance_cash_accounts', 'finance_cash_movements', 'finance_reconciliations', 'finance_payables', 'finance_supplier_payments', 'finance_budgets', 'finance_budget_lines',
    'critical_controls', 'alerts', 'corrective_actions', 'escalations', 'notification_preferences', 'notification_profile_preferences',
    'training_courses', 'training_records', 'training_materials', 'training_course_versions', 'training_modules', 'training_lessons', 'training_content_blocks', 'training_assignment_material_progress', 'training_assignment_content_progress', 'training_assignment_lesson_progress', 'training_quiz_attempts', 'training_certificates',
    'appointment_site_settings', 'appointment_services', 'appointment_desks', 'appointments', 'appointment_events', 'appointment_messages',
    'career_site_settings', 'career_job_posts', 'career_applications', 'career_application_events',
    'nutrition_feed_profiles', 'nutrition_feed_recipes', 'nutrition_feed_recipe_lines', 'nutrition_feed_orders', 'nutrition_feed_order_inputs'
  ];
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY audited_tables LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_business_change ON public.%I', table_name);
      EXECUTE format('CREATE TRIGGER audit_business_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION audit_business_change()', table_name);
    END IF;
  END LOOP;
END;
$$;

CREATE INDEX IF NOT EXISTS audit_log_area_recent_idx
  ON audit_log (organization_id, (audit_log_area(entity_table)), occurred_at DESC);
