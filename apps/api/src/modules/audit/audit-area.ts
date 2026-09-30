export type AuditArea =
  | "access"
  | "people"
  | "projects"
  | "operations"
  | "poultry"
  | "pigs"
  | "agriculture"
  | "nutrition"
  | "sales"
  | "finance"
  | "documents"
  | "security"
  | "training"
  | "appointments"
  | "recruitment"
  | "daily_work"
  | "other";

/** Mirrors the database classification so list results and PDF exports can
 * safely filter even while retaining support for older audit rows. */
export function auditAreaForTable(table: string): AuditArea {
  if (
    table.startsWith("management_project") ||
    table.startsWith("management_purchase") ||
    table.startsWith("management_receipt") ||
    table.startsWith("management_expense") ||
    table.startsWith("management_approval")
  )
    return "projects";
  if (
    table.startsWith("management_asset") ||
    table.startsWith("management_vehicle") ||
    table.startsWith("management_maintenance") ||
    table.startsWith("management_inventory") ||
    table.startsWith("management_warehouse") ||
    table.startsWith("management_material")
  )
    return "operations";
  if (table.startsWith("poultry_")) return "poultry";
  if (table.startsWith("pig_")) return "pigs";
  if (table.startsWith("agriculture_")) return "agriculture";
  if (table.startsWith("nutrition_")) return "nutrition";
  if (
    table.startsWith("sales_") ||
    [
      "customers",
      "customer_payments",
      "payment_allocations",
      "credit_notes",
    ].includes(table)
  )
    return "sales";
  if (table.startsWith("finance_")) return "finance";
  if (
    table === "employees" ||
    table.startsWith("payroll_") ||
    table.startsWith("payslip") ||
    table.startsWith("employee_") ||
    [
      "shifts",
      "shift_assignments",
      "shift_assignment_exceptions",
      "attendance_records",
      "leave_types",
      "leave_requests",
      "disciplinary_actions",
      "performance_reviews",
      "performance_review_goals",
    ].includes(table)
  )
    return "people";
  if (table.startsWith("training_")) return "training";
  if (
    [
      "documents",
      "contracts",
      "contract_templates",
      "contract_document_versions",
      "contract_signature_fields",
      "contract_signature_events",
    ].includes(table)
  )
    return "documents";
  if (
    table.startsWith("security_") ||
    [
      "incidents",
      "critical_controls",
      "alerts",
      "corrective_actions",
      "escalations",
    ].includes(table)
  )
    return "security";
  if (
    table.startsWith("appointment_") ||
    ["appointments", "appointment_events", "appointment_messages"].includes(
      table,
    )
  )
    return "appointments";
  if (table.startsWith("career_")) return "recruitment";
  if (
    [
      "organizations",
      "users",
      "roles",
      "role_permissions",
      "member_roles",
      "member_provinces",
      "organization_members",
      "organization_invitations",
      "organization_invitation_provinces",
      "organization_settings",
      "provinces",
      "sites",
      "departments",
      "notification_preferences",
      "notification_profile_preferences",
    ].includes(table)
  )
    return "access";
  if (
    table.startsWith("checklist_") ||
    [
      "daily_reports",
      "shift_handovers",
      "report_definitions",
      "report_runs",
    ].includes(table)
  )
    return "daily_work";
  return "other";
}
