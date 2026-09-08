# LiteHubs — platform structure

LiteHubs is a multi-tenant business management platform. A company signs up,
describes its business, picks a template, and gets a configured workspace.
**Congo Omega is the first tenant, not the application.**

The Congo Omega work already built (auth, roles, 433 permissions, poultry, pigs,
agriculture) is not discarded — it becomes the _Agriculture / Livestock_ template
and its industry modules. The previous tree is kept at
`apps/docs/architecture/legacy-congo-omega-structure.md`.

---

## 1. Conceptual model

```
LiteHubs (platform)
   │
   ├── platform staff .................. run LiteHubs itself
   │
   └── organizations (tenants)
          │   e.g. Congo Omega, a construction firm, a restaurant
          │
          ├── subscription + enabled modules
          ├── sites / branches
          ├── departments
          ├── members  (users ↔ organization, with roles per membership)
          └── business data (always scoped to the organization)
```

Two distinct authorization planes:

| Plane        | Example codes                                              | Stored in                |
| ------------ | ---------------------------------------------------------- | ------------------------ |
| Platform     | `platform.organizations.read`, `platform.templates.manage` | `platform_roles`         |
| Organization | `employees.create`, `poultry.flocks.update`                | `roles` (per-org scoped) |

A platform super-admin is **not** implicitly a member of every organization.
Cross-tenant reads must be an explicit, audited action.

---

## 2. Module taxonomy

```
Core modules ......... every organization can enable
    employees, attendance (incl. clock-in), shifts, leave, payroll,
    performance, training, disciplinary-actions, tasks, projects,
    documents, contracts, inventory, procurement, suppliers, customers,
    sales, finance, equipment, maintenance, incidents, security,
    approvals, reports, notifications, audit

Industry modules ..... enabled by template / industry choice
    poultry, pigs, agriculture, veterinary, agronomy, biosecurity
    (future: construction, restaurant, retail, logistics, school, clinic)

Custom modules ....... defined by the organization, no code deploy
    custom entities + fields + records, forms, views
```

A **module** is functionality. A **template** is a preset: which modules to
enable plus seed roles, departments, task types, checklists and alert rules.

```
Create organization
      ↓  industry?           agriculture / livestock / construction / … / custom
      ↓  template?           "Poultry & Pig Farm", "Crop Farm", "Blank"
      ↓  extra modules?      opt in beyond the template
      ↓  provisioning job    seeds roles, departments, checklists, alerts
      ↓  workspace ready
```

---

## 3. Repository tree

```
litehubs/
│
├── apps/
│   │
│   ├── web/                                  # Next.js dashboard
│   │   ├── app/
│   │   │   ├── (auth)/
│   │   │   │   ├── login/
│   │   │   │   ├── forgot-password/
│   │   │   │   ├── reset-password/
│   │   │   │   └── accept-invitation/
│   │   │   │
│   │   │   ├── (onboarding)/
│   │   │   │   ├── create-organization/
│   │   │   │   ├── choose-industry/
│   │   │   │   ├── choose-template/
│   │   │   │   ├── choose-modules/
│   │   │   │   ├── company-profile/
│   │   │   │   └── invite-team/
│   │   │   │
│   │   │   ├── select-organization/          # when a user belongs to several
│   │   │   │
│   │   │   ├── (platform)/                   # LiteHubs staff only
│   │   │   │   └── platform/
│   │   │   │       ├── organizations/
│   │   │   │       ├── industries/
│   │   │   │       ├── module-catalog/
│   │   │   │       ├── templates/
│   │   │   │       ├── subscriptions/
│   │   │   │       ├── platform-users/
│   │   │   │       ├── audit/
│   │   │   │       └── settings/
│   │   │   │
│   │   │   ├── (workspace)/
│   │   │   │   └── [orgSlug]/                # slug, not uuid: /congo-omega/…
│   │   │   │       ├── dashboard/
│   │   │   │       │
│   │   │   │       ├── critical-controls/
│   │   │   │       ├── daily-work/
│   │   │   │       ├── alerts/
│   │   │   │       ├── corrective-actions/
│   │   │   │       ├── escalations/
│   │   │   │       ├── approvals/
│   │   │   │       │
│   │   │   │       ├── employees/
│   │   │   │       ├── supervisors/
│   │   │   │       ├── attendance/           # clock-in lives here
│   │   │   │       │   ├── clock/
│   │   │   │       │   ├── timesheets/
│   │   │   │       │   ├── corrections/
│   │   │   │       │   └── overtime/
│   │   │   │       ├── shifts/
│   │   │   │       ├── leave/
│   │   │   │       ├── training/
│   │   │   │       ├── disciplinary-actions/
│   │   │   │       ├── payroll/
│   │   │   │       ├── performance/
│   │   │   │       │
│   │   │   │       ├── projects/             # universal, not farm-only
│   │   │   │       │   ├── list/
│   │   │   │       │   ├── phases/
│   │   │   │       │   ├── budgets/
│   │   │   │       │   └── assignments/
│   │   │   │       ├── tasks/
│   │   │   │       │   ├── assigned/
│   │   │   │       │   ├── recurring/
│   │   │   │       │   ├── completed/
│   │   │   │       │   └── overdue/
│   │   │   │       │
│   │   │   │       ├── daily-operations/
│   │   │   │       │   ├── employee-reports/
│   │   │   │       │   ├── supervisor-reports/
│   │   │   │       │   ├── manager-reports/
│   │   │   │       │   ├── shift-handover/
│   │   │   │       │   ├── daily-checklists/
│   │   │   │       │   ├── production-summary/
│   │   │   │       │   └── owner-digest/
│   │   │   │       │
│   │   │   │       ├── inventory/
│   │   │   │       │   ├── items/
│   │   │   │       │   ├── warehouses/
│   │   │   │       │   ├── stock/
│   │   │   │       │   ├── stock-movements/
│   │   │   │       │   ├── transfers/
│   │   │   │       │   ├── adjustments/
│   │   │   │       │   ├── wastage/
│   │   │   │       │   └── stock-counts/
│   │   │   │       ├── procurement/
│   │   │   │       │   ├── requests/
│   │   │   │       │   ├── purchase-orders/
│   │   │   │       │   ├── receiving/
│   │   │   │       │   └── approvals/
│   │   │   │       ├── suppliers/
│   │   │   │       ├── customers/
│   │   │   │       ├── sales/
│   │   │   │       │   ├── orders/
│   │   │   │       │   ├── invoices/
│   │   │   │       │   ├── payments/
│   │   │   │       │   ├── deliveries/
│   │   │   │       │   └── returns/
│   │   │   │       │
│   │   │   │       ├── finance/
│   │   │   │       │   ├── dashboard/
│   │   │   │       │   ├── accounts/
│   │   │   │       │   ├── cash-management/
│   │   │   │       │   ├── expenses/
│   │   │   │       │   ├── income/
│   │   │   │       │   ├── budgets/
│   │   │   │       │   ├── payables/
│   │   │   │       │   ├── receivables/
│   │   │   │       │   ├── transactions/
│   │   │   │       │   └── reconciliation/
│   │   │   │       │
│   │   │   │       ├── equipment/
│   │   │   │       │   ├── assets/
│   │   │   │       │   ├── vehicles/
│   │   │   │       │   ├── generators/
│   │   │   │       │   ├── tractors/
│   │   │   │       │   └── tools/
│   │   │   │       ├── maintenance/
│   │   │   │       │   ├── work-orders/
│   │   │   │       │   ├── preventive/
│   │   │   │       │   ├── repairs/
│   │   │   │       │   ├── inspections/
│   │   │   │       │   └── maintenance-history/
│   │   │   │       ├── incidents/
│   │   │   │       ├── losses/
│   │   │   │       ├── security/
│   │   │   │       │   ├── visitor-log/
│   │   │   │       │   ├── gate-register/
│   │   │   │       │   ├── asset-movements/
│   │   │   │       │   ├── key-register/
│   │   │   │       │   ├── theft-reports/
│   │   │   │       │   └── restricted-areas/
│   │   │   │       │
│   │   │   │       ├── poultry/               # industry module
│   │   │   │       │   ├── houses/
│   │   │   │       │   ├── flocks/
│   │   │   │       │   ├── daily-records/
│   │   │   │       │   ├── mortality/
│   │   │   │       │   ├── feed/
│   │   │   │       │   ├── water/
│   │   │   │       │   ├── weight/
│   │   │   │       │   ├── egg-production/
│   │   │   │       │   ├── health/
│   │   │   │       │   ├── vaccination/
│   │   │   │       │   ├── treatments/
│   │   │   │       │   ├── sanitation/
│   │   │   │       │   ├── biosecurity/
│   │   │   │       │   ├── production-targets/
│   │   │   │       │   └── losses/
│   │   │   │       ├── pigs/
│   │   │   │       │   ├── pens/
│   │   │   │       │   ├── animals/
│   │   │   │       │   ├── groups/
│   │   │   │       │   ├── daily-records/
│   │   │   │       │   ├── weights/
│   │   │   │       │   ├── breeding/
│   │   │   │       │   ├── pregnancies/
│   │   │   │       │   ├── farrowing/
│   │   │   │       │   ├── piglets/
│   │   │   │       │   ├── feed/
│   │   │   │       │   ├── water/
│   │   │   │       │   ├── health/
│   │   │   │       │   ├── vaccination/
│   │   │   │       │   ├── treatments/
│   │   │   │       │   ├── movements/
│   │   │   │       │   ├── quarantine/
│   │   │   │       │   ├── production-targets/
│   │   │   │       │   └── losses/
│   │   │   │       ├── agriculture/
│   │   │   │       │   ├── farms/
│   │   │   │       │   ├── fields/
│   │   │   │       │   ├── plots/
│   │   │   │       │   ├── crops/
│   │   │   │       │   ├── crop-seasons/
│   │   │   │       │   ├── operations/
│   │   │   │       │   ├── field-scouting/
│   │   │   │       │   ├── irrigation/
│   │   │   │       │   ├── fertilizer/
│   │   │   │       │   ├── pesticides/
│   │   │   │       │   ├── treatments/
│   │   │   │       │   ├── weather/
│   │   │   │       │   ├── harvest/
│   │   │   │       │   ├── production-targets/
│   │   │   │       │   └── losses/
│   │   │   │       ├── veterinary/
│   │   │   │       ├── agronomy/
│   │   │   │       ├── biosecurity/
│   │   │   │       │
│   │   │   │       ├── custom/
│   │   │   │       │   └── [moduleSlug]/      # renders from field definitions
│   │   │   │       │
│   │   │   │       ├── reports/
│   │   │   │       │   ├── employees/
│   │   │   │       │   ├── supervisors/
│   │   │   │       │   ├── poultry/
│   │   │   │       │   ├── pigs/
│   │   │   │       │   ├── agriculture/
│   │   │   │       │   ├── inventory/
│   │   │   │       │   ├── finance/
│   │   │   │       │   ├── manager/
│   │   │   │       │   └── owner/
│   │   │   │       ├── documents/
│   │   │   │       ├── contracts/
│   │   │   │       ├── audit/
│   │   │   │       ├── notifications/
│   │   │   │       │   ├── inbox/
│   │   │   │       │   └── preferences/
│   │   │   │       │
│   │   │   │       └── settings/
│   │   │   │           ├── organization/
│   │   │   │           ├── sites/
│   │   │   │           ├── departments/
│   │   │   │           ├── members/
│   │   │   │           ├── invitations/
│   │   │   │           ├── roles/
│   │   │   │           ├── modules/          # enable / disable
│   │   │   │           ├── custom-modules/   # builder
│   │   │   │           ├── billing/
│   │   │   │           └── branding/
│   │   │   │
│   │   │   ├── layout.tsx
│   │   │   └── globals.css
│   │   │
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   ├── navigation/                   # built from enabled modules
│   │   │   ├── dashboard/
│   │   │   ├── forms/
│   │   │   ├── tables/
│   │   │   ├── charts/
│   │   │   ├── alerts/
│   │   │   ├── approvals/
│   │   │   ├── tasks/
│   │   │   ├── reports/
│   │   │   ├── onboarding/
│   │   │   ├── platform/
│   │   │   ├── custom-builder/               # field/form designer
│   │   │   ├── poultry/
│   │   │   ├── pigs/
│   │   │   ├── agriculture/
│   │   │   ├── employees/
│   │   │   ├── finance/
│   │   │   ├── inventory/
│   │   │   └── ui/
│   │   │
│   │   ├── hooks/
│   │   │   ├── useAuth.ts
│   │   │   ├── useOrganization.ts             # active org + switching
│   │   │   ├── useMembership.ts
│   │   │   ├── useModules.ts                  # which modules are enabled
│   │   │   ├── usePermissions.ts
│   │   │   ├── useAlerts.ts
│   │   │   ├── useTasks.ts
│   │   │   ├── useApprovals.ts
│   │   │   └── useNotifications.ts
│   │   │
│   │   ├── lib/
│   │   │   ├── api.ts                         # sends the active org header
│   │   │   ├── auth.ts
│   │   │   ├── organization.ts
│   │   │   ├── permissions.ts
│   │   │   ├── navigation.ts                  # module → nav mapping
│   │   │   ├── constants.ts
│   │   │   └── utils.ts
│   │   │
│   │   ├── services/
│   │   │   ├── auth.service.ts
│   │   │   ├── organization.service.ts
│   │   │   ├── membership.service.ts
│   │   │   ├── module.service.ts
│   │   │   ├── template.service.ts
│   │   │   ├── custom-module.service.ts
│   │   │   ├── employee.service.ts
│   │   │   ├── attendance.service.ts
│   │   │   ├── project.service.ts
│   │   │   ├── task.service.ts
│   │   │   ├── poultry.service.ts
│   │   │   ├── pig.service.ts
│   │   │   ├── agriculture.service.ts
│   │   │   ├── inventory.service.ts
│   │   │   ├── procurement.service.ts
│   │   │   ├── finance.service.ts
│   │   │   ├── payroll.service.ts
│   │   │   ├── report.service.ts
│   │   │   ├── approval.service.ts
│   │   │   ├── alert.service.ts
│   │   │   └── notification.service.ts
│   │   │
│   │   ├── types/
│   │   ├── public/
│   │   ├── middleware.ts                      # edge: jose + org slug guard
│   │   ├── package.json
│   │   └── next.config.ts
│   │
│   └── api/
│       ├── src/
│       │   ├── app.ts
│       │   ├── server.ts
│       │   │
│       │   ├── config/
│       │   │   ├── database.ts
│       │   │   ├── env.ts
│       │   │   ├── logger.ts
│       │   │   ├── storage.ts
│       │   │   ├── security.ts
│       │   │   └── notifications.ts
│       │   │
│       │   ├── platform/                      # cross-tenant concerns
│       │   │   ├── organizations/
│       │   │   ├── memberships/
│       │   │   ├── invitations/
│       │   │   ├── industries/
│       │   │   ├── module-catalog/
│       │   │   ├── templates/
│       │   │   ├── provisioning/              # applies a template to an org
│       │   │   ├── subscriptions/
│       │   │   ├── platform-roles/
│       │   │   └── platform-admin/
│       │   │
│       │   ├── modules/                       # tenant-scoped
│       │   │   ├── auth/
│       │   │   ├── users/
│       │   │   ├── roles/
│       │   │   ├── permissions/
│       │   │   │
│       │   │   ├── sites/
│       │   │   ├── departments/
│       │   │   │
│       │   │   ├── employees/
│       │   │   ├── supervisors/
│       │   │   ├── attendance/                # clock-in, timesheets, overtime
│       │   │   ├── shifts/
│       │   │   ├── leave/
│       │   │   ├── training/
│       │   │   ├── disciplinary-actions/
│       │   │   ├── payroll/
│       │   │   ├── performance/
│       │   │   │
│       │   │   ├── projects/
│       │   │   ├── tasks/
│       │   │   ├── daily-operations/
│       │   │   ├── critical-controls/
│       │   │   ├── alerts/
│       │   │   ├── corrective-actions/
│       │   │   ├── escalations/
│       │   │   ├── approvals/
│       │   │   │
│       │   │   ├── inventory/
│       │   │   │   ├── items/
│       │   │   │   ├── warehouses/
│       │   │   │   ├── stock/
│       │   │   │   ├── movements/
│       │   │   │   ├── transfers/
│       │   │   │   ├── adjustments/
│       │   │   │   └── stock-counts/
│       │   │   ├── procurement/
│       │   │   ├── suppliers/
│       │   │   ├── customers/
│       │   │   ├── sales/
│       │   │   │
│       │   │   ├── finance/
│       │   │   │   ├── accounts/
│       │   │   │   ├── transactions/
│       │   │   │   ├── cash-management/
│       │   │   │   ├── expenses/
│       │   │   │   ├── income/
│       │   │   │   ├── budgets/
│       │   │   │   ├── payables/
│       │   │   │   ├── receivables/
│       │   │   │   └── reconciliation/
│       │   │   │
│       │   │   ├── equipment/
│       │   │   ├── vehicles/
│       │   │   ├── maintenance/
│       │   │   ├── work-orders/
│       │   │   ├── incidents/
│       │   │   ├── losses/
│       │   │   ├── security/
│       │   │   │
│       │   │   ├── industry/
│       │   │   │   ├── poultry/
│       │   │   │   │   ├── houses/
│       │   │   │   │   ├── flocks/
│       │   │   │   │   ├── daily-records/
│       │   │   │   │   ├── mortality/
│       │   │   │   │   ├── feed/
│       │   │   │   │   ├── water/
│       │   │   │   │   ├── weights/
│       │   │   │   │   ├── eggs/
│       │   │   │   │   ├── health/
│       │   │   │   │   ├── vaccinations/
│       │   │   │   │   ├── treatments/
│       │   │   │   │   ├── sanitation/
│       │   │   │   │   ├── biosecurity/
│       │   │   │   │   ├── production-targets/
│       │   │   │   │   └── losses/
│       │   │   │   ├── pigs/
│       │   │   │   │   ├── pens/
│       │   │   │   │   ├── animals/
│       │   │   │   │   ├── groups/
│       │   │   │   │   ├── daily-records/
│       │   │   │   │   ├── weights/
│       │   │   │   │   ├── feed/
│       │   │   │   │   ├── water/
│       │   │   │   │   ├── breeding/
│       │   │   │   │   ├── pregnancies/
│       │   │   │   │   ├── farrowing/
│       │   │   │   │   ├── piglets/
│       │   │   │   │   ├── health/
│       │   │   │   │   ├── vaccinations/
│       │   │   │   │   ├── treatments/
│       │   │   │   │   ├── movements/
│       │   │   │   │   ├── quarantine/
│       │   │   │   │   ├── production-targets/
│       │   │   │   │   └── losses/
│       │   │   │   ├── agriculture/
│       │   │   │   │   ├── farms/
│       │   │   │   │   ├── fields/
│       │   │   │   │   ├── plots/
│       │   │   │   │   ├── crops/
│       │   │   │   │   ├── seasons/
│       │   │   │   │   ├── operations/
│       │   │   │   │   ├── scouting/
│       │   │   │   │   ├── irrigation/
│       │   │   │   │   ├── fertilizer/
│       │   │   │   │   ├── pesticides/
│       │   │   │   │   ├── weather/
│       │   │   │   │   ├── harvest/
│       │   │   │   │   ├── production-targets/
│       │   │   │   │   └── losses/
│       │   │   │   ├── veterinary/
│       │   │   │   ├── agronomy/
│       │   │   │   └── biosecurity/
│       │   │   │
│       │   │   ├── custom/
│       │   │   │   ├── entities/              # definitions
│       │   │   │   ├── fields/
│       │   │   │   ├── records/               # jsonb payloads
│       │   │   │   └── forms/
│       │   │   │
│       │   │   ├── reports/
│       │   │   ├── documents/
│       │   │   ├── contracts/
│       │   │   ├── notifications/
│       │   │   └── audit/
│       │   │
│       │   ├── domain-rules/
│       │   │   ├── poultry/
│       │   │   ├── pigs/
│       │   │   ├── agriculture/
│       │   │   ├── employees/
│       │   │   ├── attendance/
│       │   │   ├── inventory/
│       │   │   ├── finance/
│       │   │   └── security/
│       │   │
│       │   ├── middleware/
│       │   │   ├── auth.middleware.ts
│       │   │   ├── organization.middleware.ts  # resolves + pins active org
│       │   │   ├── permissions.middleware.ts   # org-scoped codes
│       │   │   ├── platform.middleware.ts      # platform-only codes
│       │   │   ├── module-enabled.middleware.ts
│       │   │   ├── validation.middleware.ts
│       │   │   ├── audit.middleware.ts
│       │   │   ├── error.middleware.ts
│       │   │   └── rate-limit.middleware.ts
│       │   │
│       │   ├── jobs/
│       │   │   ├── critical-control-check.job.ts
│       │   │   ├── mortality-monitor.job.ts
│       │   │   ├── feed-water-monitor.job.ts
│       │   │   ├── overdue-tasks.job.ts
│       │   │   ├── vaccination-alerts.job.ts
│       │   │   ├── crop-alerts.job.ts
│       │   │   ├── inventory-alerts.job.ts
│       │   │   ├── maintenance-alerts.job.ts
│       │   │   ├── attendance-anomalies.job.ts
│       │   │   ├── report-reminders.job.ts
│       │   │   ├── approval-reminders.job.ts
│       │   │   ├── payroll-check.job.ts
│       │   │   ├── escalation.job.ts
│       │   │   ├── subscription-renewal.job.ts
│       │   │   └── token-cleanup.job.ts
│       │   │
│       │   ├── services/
│       │   │   ├── notification.service.ts
│       │   │   ├── file-storage.service.ts
│       │   │   ├── audit.service.ts
│       │   │   ├── alert-engine.service.ts
│       │   │   ├── escalation.service.ts
│       │   │   ├── approval-engine.service.ts
│       │   │   ├── provisioning.service.ts
│       │   │   └── report-generator.service.ts
│       │   │
│       │   ├── utils/
│       │   │   ├── errors.ts
│       │   │   ├── pagination.ts
│       │   │   ├── tenant-query.ts             # org-scoped query helper
│       │   │   ├── slug.ts
│       │   │   ├── money.ts
│       │   │   ├── units.ts
│       │   │   └── dates.ts
│       │   │
│       │   └── types/
│       │
│       ├── tests/
│       │   ├── unit/
│       │   ├── integration/
│       │   ├── tenancy/                        # isolation must be tested
│       │   └── e2e/
│       │
│       ├── package.json
│       ├── tsconfig.json
│       └── Dockerfile
│
├── database/
│   ├── migrations/
│   │   ├── 001_core.sql                        # applied
│   │   ├── 002_platform_identity.sql           # users + platform roles
│   │   ├── 003_organizations.sql               # orgs, settings, subscriptions
│   │   ├── 004_memberships_roles.sql           # org-scoped roles/permissions
│   │   ├── 005_module_catalog.sql              # industries, modules, features
│   │   ├── 006_templates.sql                   # templates + their presets
│   │   ├── 007_sites_departments.sql
│   │   ├── 008_employees.sql
│   │   ├── 009_attendance_clockin_shifts.sql
│   │   ├── 010_leave_training_discipline.sql
│   │   ├── 011_payroll.sql
│   │   ├── 012_projects.sql
│   │   ├── 013_tasks_daily_operations.sql
│   │   ├── 014_critical_controls.sql
│   │   ├── 015_alerts_corrective_actions.sql
│   │   ├── 016_escalations_audit.sql
│   │   ├── 017_poultry.sql
│   │   ├── 018_pigs.sql
│   │   ├── 019_agriculture.sql
│   │   ├── 020_biosecurity_health.sql
│   │   ├── 021_inventory_warehouses.sql
│   │   ├── 022_procurement_suppliers.sql
│   │   ├── 023_customers_sales.sql
│   │   ├── 024_finance.sql
│   │   ├── 025_budgets_payables_receivables.sql
│   │   ├── 026_approvals.sql
│   │   ├── 027_equipment_vehicles.sql
│   │   ├── 028_maintenance_work_orders.sql
│   │   ├── 029_incidents_losses.sql
│   │   ├── 030_security.sql
│   │   ├── 031_reports.sql
│   │   ├── 032_documents_contracts.sql
│   │   ├── 033_notifications.sql
│   │   ├── 034_custom_modules.sql
│   │   └── 035_row_level_security.sql          # RLS policies, last
│   │
│   ├── seeds/
│   │   ├── platform-roles.sql
│   │   ├── platform-permissions.sql
│   │   ├── permissions.sql                     # org-plane catalogue
│   │   ├── industries.sql
│   │   ├── modules.sql
│   │   ├── templates.sql
│   │   ├── template-poultry-pig-farm.sql
│   │   ├── template-crop-farm.sql
│   │   ├── template-blank.sql
│   │   ├── role-presets.sql
│   │   ├── units.sql
│   │   ├── task-types.sql
│   │   ├── critical-controls.sql
│   │   ├── alert-definitions.sql
│   │   ├── approval-rules.sql
│   │   └── notification-types.sql
│   │
│   ├── views/
│   ├── functions/
│   └── triggers/
│
├── packages/
│   ├── shared-types/src/
│   │   ├── auth.ts
│   │   ├── platform.ts
│   │   ├── organization.ts
│   │   ├── membership.ts
│   │   ├── module.ts
│   │   ├── template.ts
│   │   ├── custom-module.ts
│   │   ├── employee.ts
│   │   ├── attendance.ts
│   │   ├── project.ts
│   │   ├── task.ts
│   │   ├── poultry.ts
│   │   ├── pig.ts
│   │   ├── agriculture.ts
│   │   ├── inventory.ts
│   │   ├── finance.ts
│   │   ├── approvals.ts
│   │   ├── reports.ts
│   │   └── alerts.ts
│   ├── validation/src/
│   └── config/src/
│
├── docs/
│   ├── architecture/
│   │   ├── legacy-congo-omega-structure.md
│   │   ├── tenancy.md
│   │   ├── permissions.md
│   │   └── provisioning.md
│   ├── api/
│   ├── database/
│   ├── templates/
│   ├── poultry-sops/
│   ├── pig-sops/
│   ├── agriculture-sops/
│   ├── veterinary-sops/
│   ├── biosecurity/
│   ├── employee-procedures/
│   ├── finance-procedures/
│   ├── inventory-procedures/
│   ├── security-procedures/
│   └── emergency-procedures/
│
├── scripts/
│   ├── migrate.ts
│   ├── seed.ts
│   ├── backup.ts
│   ├── restore.ts
│   ├── create-platform-admin.ts               # replaces create-owner
│   ├── create-organization.ts                 # org + owner + template
│   └── check-tenant-isolation.ts              # audits for unscoped tables
│
├── storage/
│   └── organizations/<organizationId>/         # never a shared flat folder
│       ├── contracts/
│       ├── employee-documents/
│       ├── reports/
│       ├── incident-evidence/
│       └── receipts/
│
├── .github/workflows/
├── .env.example
├── docker-compose.yml
├── package.json
├── README.md
└── turbo.json
```

---

## 4. Tenant isolation rules

These are not style preferences. Breaking any of them leaks one company's data
to another.

**1. Every tenant table carries `organization_id`, NOT NULL.**

**2. Do not rely on remembering `WHERE organization_id = $1`.**
That is the single likeliest source of a leak across 100+ modules. Two layers:

- `organization.middleware.ts` resolves the active org and opens the request's
  transaction with `SET LOCAL app.organization_id = '<uuid>'`.
- Migration `035` enables **row-level security** on every tenant table with a
  policy of `organization_id = current_setting('app.organization_id')::uuid`.

The explicit `WHERE` stays as the fast path; RLS is the backstop for the day
someone forgets it.

**3. Unique constraints must be composite.**
`UNIQUE (code)` becomes `UNIQUE (organization_id, code)`. Otherwise the second
company cannot create a site called "Main" or an item with SKU "FEED-01".

**4. Foreign keys must not cross tenants.**
A plain `flocks.house_id → houses.id` still lets one org reference another's
house. Carry `organization_id` in both and use a composite FK:

```sql
FOREIGN KEY (organization_id, house_id)
  REFERENCES poultry_houses (organization_id, id)
```

**5. Platform-plane tables stay global**: `users`, `refresh_tokens`,
`password_reset_tokens`, `platform_roles`, `industries`, `modules`, `templates`.
A session belongs to a person, not to a company.

**6. `tests/tenancy/` must prove it.** For every module: create two orgs, write
data in both, and assert each sees only its own — including via list, search,
detail-by-id, update, and delete.

---

## 5. What this breaks in the code already written

Honest accounting — these are not additive changes.

| Built                             | Problem                                                                       | Fix                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `user_roles (user_id, role_id)`   | Roles are **global**. Joel as owner of Congo Omega would be owner everywhere. | Roles move to the membership: `organization_member_roles`.           |
| `roles`, `permissions` seeds      | One global set; no platform/org split.                                        | Split into platform and org planes; org roles get `organization_id`. |
| `authenticate` middleware         | Loads permissions from a global join.                                         | Must resolve permissions for the **active organization**.            |
| Access token claims               | `sub`, `email`, `roles`.                                                      | Add active `org` claim, plus an org-switch endpoint.                 |
| `create-owner.ts`                 | Creates a globally-privileged owner.                                          | Becomes `create-platform-admin.ts` + `create-organization.ts`.       |
| `002_users_roles_permissions.sql` | Mixes platform identity with org roles.                                       | Split into `002_platform_identity` + `004_memberships_roles`.        |

**Recommendation: reset the database rather than patch it.** The pasted plan
says "never edit an applied migration, add a 003" — right in general, wrong here.
Only 2 migrations are applied, and the data is 2 owner accounts and zero business
records. Rewriting `002` and re-running from scratch costs one command and yields
a clean schema; a patch migration that retrofits membership-scoped roles onto a
global `user_roles` leaves a seam in the foundation forever.

---

## 6. Corrections applied to the proposed plan

1. **One name.** Platform is _LiteHubs_; "HUBONE" was a leftover. The npm root
   package renames `congo-omega` → `litehubs`.
2. **RLS + `SET LOCAL`**, not developer discipline alone (§4.2).
3. **Composite uniques** (§4.3) — omitted from the plan, breaks the 2nd tenant.
4. **Composite FKs** (§4.4) — omitted; plain FKs leak across tenants.
5. **Roles must be membership-scoped** (§5) — the plan proposed
   `organization_members` but never said `user_roles` has to change, which is the
   actual breaking change.
6. **Auth needs an active-org claim and a switch flow** — not mentioned.
7. **Reset, don't patch** (§5) — the plan's migration advice is wrong for the
   current state.
8. **No EAV, no workflow engine yet.** `custom_records` +
   `custom_record_values` + `workflows` + `workflow_runs` is a large subsystem
   that is slow to query and hard to report on. Use one `custom_records` table
   with a `jsonb` payload validated against the org's field definitions, and GIN
   indexes. Defer the workflow engine until a real customer needs it — the
   existing `approvals` module already covers approve/reject.
9. **One attendance module, not three.** The plan added `time-tracking/`
   alongside the existing `attendance/` and `shifts/`. Clock-in, timesheets,
   overtime and corrections are _features of attendance_.
10. **Slugs in URLs**, not UUIDs: `/congo-omega/dashboard`.
11. **Platform vs tenant code separated** into `src/platform/` and
    `src/modules/`, instead of one flat `modules/` holding both.
12. **Added what the plan omitted**: `organization_invitations` (how does a
    company add its second member?), `industries`, module dependencies,
    provisioning as an explicit job, per-organization storage prefixes, and
    `tests/tenancy/`.

---

## 7. Build order

```
Phase 1  tenancy foundation
         002 split, 003 organizations, 004 memberships+roles, 035 RLS
         organization.middleware.ts, auth rework, org switching
         scripts: create-platform-admin, create-organization

Phase 2  catalogue and onboarding
         005 module catalog, 006 templates, provisioning service
         onboarding UI, dynamic navigation from enabled modules

Phase 3  core modules
         sites, departments, employees, attendance+clock-in, projects, tasks

Phase 4  industry modules
         poultry, pigs, agriculture  (Congo Omega's template)

Phase 5  operations and money
         inventory, procurement, sales, finance, approvals, reports

Phase 6  custom module builder
         jsonb-backed entities, fields, forms
```

Nothing in phases 3–5 should be written before phase 1 lands, because every
table they create needs `organization_id` and an RLS policy from birth.

---

## 8. Status — Phase 1 landed (2026-08-21)

> **This section covers the tenancy foundation only, and stops at migration 007.**
> Much more has been built since: employee profiles, shifts and attendance,
> poultry operations and performance models, pig operations, agriculture
> operations, the Owner Management layer, company setup (provinces, sites,
> departments, roles, members, invitations) and image uploads — migrations
> 008–025, 106 endpoints across 9 route modules.
>
> The living record of that work is
> [`apps/docs/architecture/congo-omega-foundation.md`](apps/docs/architecture/congo-omega-foundation.md),
> which is kept current per feature and has the API walkthroughs. Read it first;
> read this section only for *why the tenancy design is the way it is*.

Congo Omega now exists as a tenant of LiteHubs, not as the application.

**Database** — migrations `001`–`006` applied. RLS is enabled and _forced_ on
every tenant table, with the policy written into the migration that creates the
table rather than deferred to a single `035`. That is a deliberate divergence
from the tree above: a table cannot be created without its policy if the two
live in the same file.

Seeded: 459 organization permissions, 11 role presets with 1,638 grants,
9 industries, 4 platform roles.

**Provisioning** — `provisionOrganization()` creates the organization, its
settings, a 30-day trial subscription, its own copy of the role presets with
their grants, and the creating user as owner — in one transaction, as the
least-privilege app role, with no RLS bypass anywhere.

Two RLS traps were hit and are worth recording, because both look like bugs in
the policy and are not:

1. _An insert can be rejected for the read-back, not the write._ Under RLS a
   written row must also be visible through the SELECT policy, so
   `INSERT INTO organizations … RETURNING id` failed — a brand-new organization
   is neither the active one nor one you are yet a member of. The error names
   the write policy, which sends you to the wrong place. Fixed by generating the
   id in the service and pinning `app.organization_id` to it _before_ the
   insert, so no read-back is needed.
2. _A uniqueness pre-check under RLS is theatre._ `SELECT 1 FROM organizations
WHERE slug = $1` can never see another tenant's row, so it always passes.
   The unique constraint is the only honest arbiter, and it is race-free —
   `23505` is translated to a 409.

**Auth** — reworked onto membership-scoped roles. `user_roles` is gone.

| Concern                    | Where                                            |
| -------------------------- | ------------------------------------------------ |
| Identity + platform grants | `users` ⋈ `user_platform_roles` — global, no RLS |
| Workspace list             | `findMemberships()`, under user context          |
| Grants in one workspace    | `findActiveMembership()`, under tenant context   |
| Active workspace           | `org` claim, re-proved on every request          |

The `org` claim is a default, never an authority: `requireOrganization` reloads
the membership behind it, so a token cannot keep someone inside an organization
they were removed from. Roles are not in the token at all — they are per
organization and would go stale inside its 15-minute life.

Resolution order for "which workspace is this request about":
path `:orgSlug` → `X-Organization-Slug` / `X-Organization-Id` → `org` claim.
A slug is mapped through the caller's own memberships, so a foreign slug is
indistinguishable from one that does not exist (404, not 403).

**Middleware** — `organization.middleware.ts` (`requireOrganization`,
`resolveOrganization`), `platform.middleware.ts`, and `permissions.middleware.ts`
now reading org-scoped codes off the active membership.

One divergence from §4.2: the middleware does not hold a transaction open for
the request lifetime. It attaches `req.tenant.run()`, bound to the resolved
organization, which is `withTenantContext` under the hood. Same guarantee —
every tenant query runs with `app.organization_id` pinned — without a pooled
connection held across a slow request.

**Registration** — `POST /api/v1/auth/register` takes the person and their
company together and signs them in as owner.

The two commit in **one transaction**, which is the whole design of it. Split
apart, a slug that turned out to be taken would leave behind an account whose
email is now also taken — so that person could neither finish signing up nor
start again, and the only failing case would be the one that traps them. To
make that possible, `provisionOrganizationIn(client, …)` joins a caller's
transaction; `provisionOrganization(…)` is the wrapper that opens its own.

Industry validation moved into provisioning, so the CLI, onboarding and signup
cannot disagree about what is on offer. The foreign key already rejects an
unknown code; what it cannot see is whether the industry is still active.

**Endpoints live**

```
POST /api/v1/auth/register                  signup: person + company, as owner
GET  /api/v1/industries                     catalogue for onboarding (public)
GET  /api/v1/organizations                  my workspaces
POST /api/v1/organizations                  add another workspace (signed in)
GET  /api/v1/organizations/:orgSlug         profile + my roles there
POST /api/v1/auth/switch-organization       move the session
POST /api/v1/auth/refresh                   takes organizationSlug
GET  /api/v1/auth/me                        honours the org header
```

**Tests** — 15 passing across two files.

`api/tests/integration/register.test.ts` covers signup: the happy path, a taken
slug leaving no account behind, a duplicate email, an inactive industry, the
password policy, and a fresh owner failing to reach a neighbour's workspace.

`api/tests/tenancy/isolation.test.ts`, 9 passing. Two organizations,
real rows in both, asserting isolation across unqualified list, detail-by-id,
update, delete, cross-stamped insert, membership visibility, the unpinned
connection, and context leaking onto a pooled connection.

`tests/setup.ts` refuses to run the suite at all if `DATABASE_URL` can bypass
RLS. Without that check a superuser connection makes all nine tests pass while
proving nothing — which is the failure mode that matters here.

### Known gaps

- **The monorepo root is `apps/`, not the repository root.** `apps/` holds
  `api/`, `web/`, `database/`, `packages/` and the root `package.json`, so the
  tree in §3 is one level off from what is on disk. Cosmetic, but it will
  confuse every path in this document until it is moved.
- `scripts/backup.ts` and `scripts/restore.ts` are empty files still wired to
  `npm run db:backup` / `db:restore`. An empty script exits 0, so a backup
  command that does nothing _reports success_. Fix or unwire before this matters.
- **`apps/web/` is 32 empty files.** Every `.ts`/`.tsx` under it is 0 bytes,
  including `layout.tsx`, `middleware.ts`, `lib/api.ts` and every hook and
  service. The dashboard has not been started, so nothing in §3's `app/` tree
  exists yet and the API is currently only reachable by HTTP client.
- `api/src/modules/` still holds the legacy flat layout — `poultry/`, `pigs/`,
  `agriculture/` at the top level rather than under `industry/`, and 40-odd
  empty module directories. Phase 3+ work.
- `src/platform/` holds only `provisioning/`. The module catalogue, templates,
  industries admin and subscriptions (Phase 2) are not built.
- SMTP credentials in `.env` are rejected by Brevo (`535 5.7.8`). Password reset
  falls back to logging the link, which is fine in development and not in
  production.
- Migration `005_role_presets` and `006_organization_creation_policy` do not
  appear in the §3 tree; the numbering there was aspirational.
