congo-omega/
│
├── apps/
│ │
│ ├── web/ # Next.js / React frontend
│ │ ├── app/
│ │ │ ├── (auth)/
│ │ │ │ ├── login/
│ │ │ │ ├── forgot-password/
│ │ │ │ └── reset-password/
│ │ │ │
│ │ │ ├── dashboard/
│ │ │ │ ├── page.tsx # Main management dashboard
│ │ │ │ │
│ │ │ │ ├── critical-controls/
│ │ │ │ ├── daily-work/
│ │ │ │ ├── alerts/
│ │ │ │ ├── corrective-actions/
│ │ │ │ ├── escalations/
│ │ │ │ │
│ │ │ │ ├── poultry/
│ │ │ │ │ ├── page.tsx
│ │ │ │ │ ├── houses/
│ │ │ │ │ ├── flocks/
│ │ │ │ │ ├── daily-records/
│ │ │ │ │ ├── mortality/
│ │ │ │ │ ├── feed/
│ │ │ │ │ ├── water/
│ │ │ │ │ ├── weight/
│ │ │ │ │ ├── egg-production/
│ │ │ │ │ ├── health/
│ │ │ │ │ ├── vaccination/
│ │ │ │ │ ├── treatments/
│ │ │ │ │ ├── sanitation/
│ │ │ │ │ ├── biosecurity/
│ │ │ │ │ ├── production-targets/
│ │ │ │ │ └── losses/
│ │ │ │ │
│ │ │ │ ├── pigs/
│ │ │ │ │ ├── page.tsx
│ │ │ │ │ ├── pens/
│ │ │ │ │ ├── animals/
│ │ │ │ │ ├── groups/
│ │ │ │ │ ├── daily-records/
│ │ │ │ │ ├── weights/
│ │ │ │ │ ├── breeding/
│ │ │ │ │ ├── pregnancies/
│ │ │ │ │ ├── farrowing/
│ │ │ │ │ ├── piglets/
│ │ │ │ │ ├── feed/
│ │ │ │ │ ├── water/
│ │ │ │ │ ├── health/
│ │ │ │ │ ├── vaccination/
│ │ │ │ │ ├── treatments/
│ │ │ │ │ ├── movements/
│ │ │ │ │ ├── quarantine/
│ │ │ │ │ ├── production-targets/
│ │ │ │ │ └── losses/
│ │ │ │ │
│ │ │ │ ├── agriculture/
│ │ │ │ │ ├── page.tsx
│ │ │ │ │ ├── farms/
│ │ │ │ │ ├── fields/
│ │ │ │ │ ├── plots/
│ │ │ │ │ ├── crops/
│ │ │ │ │ ├── crop-seasons/
│ │ │ │ │ ├── operations/
│ │ │ │ │ ├── field-scouting/
│ │ │ │ │ ├── irrigation/
│ │ │ │ │ ├── fertilizer/
│ │ │ │ │ ├── pesticides/
│ │ │ │ │ ├── treatments/
│ │ │ │ │ ├── weather/
│ │ │ │ │ ├── harvest/
│ │ │ │ │ ├── production-targets/
│ │ │ │ │ └── losses/
│ │ │ │ │
│ │ │ │ ├── veterinary/
│ │ │ │ ├── agronomy/
│ │ │ │ ├── biosecurity/
│ │ │ │ │
│ │ │ │ ├── employees/
│ │ │ │ ├── supervisors/
│ │ │ │ ├── attendance/
│ │ │ │ ├── shifts/
│ │ │ │ ├── leave/
│ │ │ │ ├── training/
│ │ │ │ ├── disciplinary-actions/
│ │ │ │ ├── payroll/
│ │ │ │ ├── performance/
│ │ │ │ │
│ │ │ │ ├── daily-operations/
│ │ │ │ │ ├── employee-reports/
│ │ │ │ │ ├── supervisor-reports/
│ │ │ │ │ ├── manager-reports/
│ │ │ │ │ ├── shift-handover/
│ │ │ │ │ ├── daily-checklists/
│ │ │ │ │ ├── production-summary/
│ │ │ │ │ └── owner-digest/
│ │ │ │ │
│ │ │ │ ├── tasks/
│ │ │ │ │ ├── assigned/
│ │ │ │ │ ├── recurring/
│ │ │ │ │ ├── completed/
│ │ │ │ │ └── overdue/
│ │ │ │ │
│ │ │ │ ├── inventory/
│ │ │ │ │ ├── items/
│ │ │ │ │ ├── warehouses/
│ │ │ │ │ ├── stock/
│ │ │ │ │ ├── stock-movements/
│ │ │ │ │ ├── transfers/
│ │ │ │ │ ├── adjustments/
│ │ │ │ │ ├── wastage/
│ │ │ │ │ └── stock-counts/
│ │ │ │ │
│ │ │ │ ├── procurement/
│ │ │ │ │ ├── requests/
│ │ │ │ │ ├── purchase-orders/
│ │ │ │ │ ├── receiving/
│ │ │ │ │ └── approvals/
│ │ │ │ │
│ │ │ │ ├── suppliers/
│ │ │ │ ├── customers/
│ │ │ │ │
│ │ │ │ ├── sales/
│ │ │ │ │ ├── orders/
│ │ │ │ │ ├── invoices/
│ │ │ │ │ ├── payments/
│ │ │ │ │ ├── deliveries/
│ │ │ │ │ └── returns/
│ │ │ │ │
│ │ │ │ ├── finance/
│ │ │ │ │ ├── dashboard/
│ │ │ │ │ ├── accounts/
│ │ │ │ │ ├── cash-management/
│ │ │ │ │ ├── expenses/
│ │ │ │ │ ├── income/
│ │ │ │ │ ├── budgets/
│ │ │ │ │ ├── payables/
│ │ │ │ │ ├── receivables/
│ │ │ │ │ ├── transactions/
│ │ │ │ │ └── reconciliation/
│ │ │ │ │
│ │ │ │ ├── approvals/
│ │ │ │ │
│ │ │ │ ├── equipment/
│ │ │ │ │ ├── assets/
│ │ │ │ │ ├── vehicles/
│ │ │ │ │ ├── generators/
│ │ │ │ │ ├── tractors/
│ │ │ │ │ └── tools/
│ │ │ │ │
│ │ │ │ ├── maintenance/
│ │ │ │ │ ├── work-orders/
│ │ │ │ │ ├── preventive/
│ │ │ │ │ ├── repairs/
│ │ │ │ │ ├── inspections/
│ │ │ │ │ └── maintenance-history/
│ │ │ │ │
│ │ │ │ ├── incidents/
│ │ │ │ ├── losses/
│ │ │ │ │
│ │ │ │ ├── security/
│ │ │ │ │ ├── visitor-log/
│ │ │ │ │ ├── gate-register/
│ │ │ │ │ ├── asset-movements/
│ │ │ │ │ ├── key-register/
│ │ │ │ │ ├── theft-reports/
│ │ │ │ │ └── restricted-areas/
│ │ │ │ │
│ │ │ │ ├── reports/
│ │ │ │ │ ├── employees/
│ │ │ │ │ ├── supervisors/
│ │ │ │ │ ├── poultry/
│ │ │ │ │ ├── pigs/
│ │ │ │ │ ├── agriculture/
│ │ │ │ │ ├── inventory/
│ │ │ │ │ ├── finance/
│ │ │ │ │ ├── manager/
│ │ │ │ │ └── owner/
│ │ │ │ │
│ │ │ │ ├── documents/
│ │ │ │ ├── contracts/
│ │ │ │ ├── audit/
│ │ │ │ │
│ │ │ │ ├── organization/
│ │ │ │ │ ├── company/
│ │ │ │ │ ├── sites/
│ │ │ │ │ ├── departments/
│ │ │ │ │ └── organizational-chart/
│ │ │ │ │
│ │ │ │ ├── notifications/
│ │ │ │ │ ├── inbox/
│ │ │ │ │ └── preferences/
│ │ │ │ │
│ │ │ │ └── settings/
│ │ │ │
│ │ │ ├── layout.tsx
│ │ │ └── globals.css
│ │ │
│ │ ├── components/
│ │ │ ├── layout/
│ │ │ ├── dashboard/
│ │ │ ├── forms/
│ │ │ ├── tables/
│ │ │ ├── charts/
│ │ │ ├── alerts/
│ │ │ ├── approvals/
│ │ │ ├── tasks/
│ │ │ ├── reports/
│ │ │ ├── poultry/
│ │ │ ├── pigs/
│ │ │ ├── agriculture/
│ │ │ ├── employees/
│ │ │ ├── finance/
│ │ │ ├── inventory/
│ │ │ └── ui/
│ │ │
│ │ ├── hooks/
│ │ │ ├── useAuth.ts
│ │ │ ├── usePermissions.ts
│ │ │ ├── useAlerts.ts
│ │ │ ├── useTasks.ts
│ │ │ ├── useApprovals.ts
│ │ │ └── useNotifications.ts
│ │ │
│ │ ├── lib/
│ │ │ ├── api.ts
│ │ │ ├── auth.ts
│ │ │ ├── permissions.ts
│ │ │ ├── constants.ts
│ │ │ └── utils.ts
│ │ │
│ │ ├── services/
│ │ │ ├── auth.service.ts
│ │ │ ├── employee.service.ts
│ │ │ ├── task.service.ts
│ │ │ ├── poultry.service.ts
│ │ │ ├── pig.service.ts
│ │ │ ├── agriculture.service.ts
│ │ │ ├── inventory.service.ts
│ │ │ ├── procurement.service.ts
│ │ │ ├── finance.service.ts
│ │ │ ├── payroll.service.ts
│ │ │ ├── report.service.ts
│ │ │ ├── approval.service.ts
│ │ │ ├── alert.service.ts
│ │ │ └── notification.service.ts
│ │ │
│ │ ├── types/
│ │ ├── public/
│ │ ├── middleware.ts
│ │ ├── package.json
│ │ └── next.config.ts
│ │
│ │
│ └── api/ # Node.js / Express API
│ ├── src/
│ │ ├── app.ts
│ │ ├── server.ts
│ │ │
│ │ ├── config/
│ │ │ ├── database.ts
│ │ │ ├── env.ts
│ │ │ ├── logger.ts
│ │ │ ├── storage.ts
│ │ │ ├── security.ts
│ │ │ └── notifications.ts
│ │ │
│ │ ├── modules/
│ │ │ ├── auth/
│ │ │ ├── users/
│ │ │ ├── roles/
│ │ │ ├── permissions/
│ │ │ │
│ │ │ ├── organization/
│ │ │ ├── sites/
│ │ │ ├── departments/
│ │ │ │
│ │ │ ├── employees/
│ │ │ ├── supervisors/
│ │ │ ├── attendance/
│ │ │ ├── shifts/
│ │ │ ├── leave/
│ │ │ ├── training/
│ │ │ ├── disciplinary-actions/
│ │ │ ├── payroll/
│ │ │ ├── performance/
│ │ │ │
│ │ │ ├── tasks/
│ │ │ ├── daily-operations/
│ │ │ ├── critical-controls/
│ │ │ ├── alerts/
│ │ │ ├── corrective-actions/
│ │ │ ├── escalations/
│ │ │ │
│ │ │ ├── poultry/
│ │ │ │ ├── houses/
│ │ │ │ ├── flocks/
│ │ │ │ ├── daily-records/
│ │ │ │ ├── mortality/
│ │ │ │ ├── feed/
│ │ │ │ ├── water/
│ │ │ │ ├── weights/
│ │ │ │ ├── eggs/
│ │ │ │ ├── health/
│ │ │ │ ├── vaccinations/
│ │ │ │ ├── treatments/
│ │ │ │ ├── sanitation/
│ │ │ │ ├── biosecurity/
│ │ │ │ ├── production-targets/
│ │ │ │ └── losses/
│ │ │ │
│ │ │ ├── pigs/
│ │ │ │ ├── pens/
│ │ │ │ ├── animals/
│ │ │ │ ├── groups/
│ │ │ │ ├── daily-records/
│ │ │ │ ├── weights/
│ │ │ │ ├── feed/
│ │ │ │ ├── water/
│ │ │ │ ├── breeding/
│ │ │ │ ├── pregnancies/
│ │ │ │ ├── farrowing/
│ │ │ │ ├── piglets/
│ │ │ │ ├── health/
│ │ │ │ ├── vaccinations/
│ │ │ │ ├── treatments/
│ │ │ │ ├── movements/
│ │ │ │ ├── quarantine/
│ │ │ │ ├── production-targets/
│ │ │ │ └── losses/
│ │ │ │
│ │ │ ├── agriculture/
│ │ │ │ ├── farms/
│ │ │ │ ├── fields/
│ │ │ │ ├── plots/
│ │ │ │ ├── crops/
│ │ │ │ ├── seasons/
│ │ │ │ ├── operations/
│ │ │ │ ├── scouting/
│ │ │ │ ├── irrigation/
│ │ │ │ ├── fertilizer/
│ │ │ │ ├── pesticides/
│ │ │ │ ├── weather/
│ │ │ │ ├── harvest/
│ │ │ │ ├── production-targets/
│ │ │ │ └── losses/
│ │ │ │
│ │ │ ├── veterinary/
│ │ │ ├── agronomy/
│ │ │ ├── biosecurity/
│ │ │ │
│ │ │ ├── inventory/
│ │ │ │ ├── items/
│ │ │ │ ├── warehouses/
│ │ │ │ ├── stock/
│ │ │ │ ├── movements/
│ │ │ │ ├── transfers/
│ │ │ │ ├── adjustments/
│ │ │ │ └── stock-counts/
│ │ │ │
│ │ │ ├── procurement/
│ │ │ ├── suppliers/
│ │ │ ├── customers/
│ │ │ ├── sales/
│ │ │ │
│ │ │ ├── finance/
│ │ │ │ ├── accounts/
│ │ │ │ ├── transactions/
│ │ │ │ ├── cash-management/
│ │ │ │ ├── expenses/
│ │ │ │ ├── income/
│ │ │ │ ├── budgets/
│ │ │ │ ├── payables/
│ │ │ │ ├── receivables/
│ │ │ │ └── reconciliation/
│ │ │ │
│ │ │ ├── approvals/
│ │ │ │
│ │ │ ├── equipment/
│ │ │ ├── vehicles/
│ │ │ ├── maintenance/
│ │ │ ├── work-orders/
│ │ │ ├── incidents/
│ │ │ ├── losses/
│ │ │ ├── security/
│ │ │ │
│ │ │ ├── reports/
│ │ │ ├── documents/
│ │ │ ├── contracts/
│ │ │ ├── notifications/
│ │ │ └── audit/
│ │ │
│ │ ├── domain-rules/
│ │ │ ├── poultry/
│ │ │ ├── pigs/
│ │ │ ├── agriculture/
│ │ │ ├── employees/
│ │ │ ├── inventory/
│ │ │ ├── finance/
│ │ │ └── security/
│ │ │
│ │ ├── middleware/
│ │ │ ├── auth.middleware.ts
│ │ │ ├── permissions.middleware.ts
│ │ │ ├── error.middleware.ts
│ │ │ ├── validation.middleware.ts
│ │ │ ├── audit.middleware.ts
│ │ │ └── rate-limit.middleware.ts
│ │ │
│ │ ├── jobs/
│ │ │ ├── critical-control-check.job.ts
│ │ │ ├── mortality-monitor.job.ts
│ │ │ ├── feed-water-monitor.job.ts
│ │ │ ├── overdue-tasks.job.ts
│ │ │ ├── vaccination-alerts.job.ts
│ │ │ ├── crop-alerts.job.ts
│ │ │ ├── inventory-alerts.job.ts
│ │ │ ├── maintenance-alerts.job.ts
│ │ │ ├── report-reminders.job.ts
│ │ │ ├── approval-reminders.job.ts
│ │ │ ├── payroll-check.job.ts
│ │ │ └── escalation.job.ts
│ │ │
│ │ ├── services/
│ │ │ ├── notification.service.ts
│ │ │ ├── file-storage.service.ts
│ │ │ ├── audit.service.ts
│ │ │ ├── alert-engine.service.ts
│ │ │ ├── escalation.service.ts
│ │ │ ├── approval-engine.service.ts
│ │ │ └── report-generator.service.ts
│ │ │
│ │ ├── utils/
│ │ │ ├── errors.ts
│ │ │ ├── pagination.ts
│ │ │ ├── money.ts
│ │ │ ├── units.ts
│ │ │ └── dates.ts
│ │ │
│ │ └── types/
│ │
│ ├── tests/
│ │ ├── unit/
│ │ ├── integration/
│ │ └── e2e/
│ │
│ ├── package.json
│ ├── tsconfig.json
│ └── Dockerfile
│
│
├── database/
│ ├── migrations/
│ │ ├── 001_core.sql
│ │ ├── 002_users_roles_permissions.sql
│ │ ├── 003_organization_sites_departments.sql
│ │ ├── 004_employees.sql
│ │ ├── 005_attendance_shifts_leave.sql
│ │ ├── 006_training_discipline_performance.sql
│ │ ├── 007_payroll.sql
│ │ ├── 008_tasks_daily_operations.sql
│ │ ├── 009_critical_controls.sql
│ │ ├── 010_alerts_corrective_actions.sql
│ │ ├── 011_escalations_audit.sql
│ │ ├── 012_poultry.sql
│ │ ├── 013_pigs.sql
│ │ ├── 014_agriculture.sql
│ │ ├── 015_biosecurity_health.sql
│ │ ├── 016_inventory_warehouses.sql
│ │ ├── 017_procurement_suppliers.sql
│ │ ├── 018_customers_sales.sql
│ │ ├── 019_finance.sql
│ │ ├── 020_budgets_payables_receivables.sql
│ │ ├── 021_approvals.sql
│ │ ├── 022_equipment_vehicles.sql
│ │ ├── 023_maintenance_work_orders.sql
│ │ ├── 024_incidents_losses.sql
│ │ ├── 025_security.sql
│ │ ├── 026_reports.sql
│ │ ├── 027_documents_contracts.sql
│ │ └── 028_notifications.sql
│ │
│ ├── seeds/
│ │ ├── roles.sql
│ │ ├── permissions.sql
│ │ ├── units.sql
│ │ ├── departments.sql
│ │ ├── task-types.sql
│ │ ├── critical-controls.sql
│ │ ├── alert-definitions.sql
│ │ ├── approval-rules.sql
│ │ └── notification-types.sql
│ │
│ ├── views/
│ │ ├── poultry_daily_summary.sql
│ │ ├── pig_daily_summary.sql
│ │ ├── agriculture_summary.sql
│ │ ├── inventory_balance.sql
│ │ ├── employee_performance.sql
│ │ ├── finance_summary.sql
│ │ ├── outstanding_approvals.sql
│ │ ├── critical_alerts.sql
│ │ └── owner_dashboard.sql
│ │
│ ├── functions/
│ │ ├── calculate_mortality.sql
│ │ ├── calculate_feed_conversion.sql
│ │ ├── calculate_inventory.sql
│ │ ├── calculate_profitability.sql
│ │ ├── calculate_payroll.sql
│ │ ├── create_alert.sql
│ │ ├── escalate_alert.sql
│ │ └── audit_trigger.sql
│ │
│ └── triggers/
│ ├── audit.triggers.sql
│ ├── inventory.triggers.sql
│ └── finance.triggers.sql
│
│
├── packages/
│ ├── shared-types/
│ │ └── src/
│ │ ├── auth.ts
│ │ ├── organization.ts
│ │ ├── employee.ts
│ │ ├── task.ts
│ │ ├── poultry.ts
│ │ ├── pig.ts
│ │ ├── agriculture.ts
│ │ ├── inventory.ts
│ │ ├── finance.ts
│ │ ├── approvals.ts
│ │ ├── reports.ts
│ │ └── alerts.ts
│ │
│ ├── validation/
│ │ └── src/
│ │
│ └── config/
│ └── src/
│
│
├── docs/
│ ├── architecture/
│ ├── database/
│ ├── api/
│ ├── permissions/
│ ├── poultry-sops/
│ ├── pig-sops/
│ ├── agriculture-sops/
│ ├── veterinary-sops/
│ ├── biosecurity/
│ ├── employee-procedures/
│ ├── finance-procedures/
│ ├── inventory-procedures/
│ ├── security-procedures/
│ └── emergency-procedures/
│
│
├── scripts/
│ ├── migrate.ts
│ ├── seed.ts
│ ├── backup.ts
│ ├── restore.ts
│ ├── create-admin.ts
│ └── create-owner.ts
│
├── storage/
│ ├── contracts/
│ ├── employee-documents/
│ ├── reports/
│ ├── incident-evidence/
│ ├── receipts/
│ └── README.md
│
├── .github/
│ └── workflows/
│ ├── test.yml
│ ├── database.yml
│ └── deploy.yml
│
├── .env.example
├── .gitignore
├── docker-compose.yml
├── package.json
├── README.md
└── turbo.json
