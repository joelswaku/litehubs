# LiteHubs Platform Staff

This is separate from every customer company. A LiteHubs staff role does **not**
make a person an employee, owner, manager, or member of Congo Omega.

## Built roles

| Role                 | Purpose                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------- |
| Platform Super Admin | Runs LiteHubs. Can create staff accounts, assign staff roles, and suspend staff accounts. |
| Platform Admin       | Platform administration role. It cannot assign platform staff roles.                      |
| Platform Support     | Support role. It does not automatically open any company data.                            |
| Platform Billing     | Subscription and billing role. It does not open company data.                             |

## API

All routes require a LiteHubs staff login and use `/api/v1`.

- `GET /platform/staff/roles` — all staff can view the four built-in roles.
- `GET /platform/staff/users` — Super Admin only.
- `POST /platform/staff/users` — Super Admin only; creates a staff account and makes password change mandatory on first login.
- `PUT /platform/staff/users/:userId/roles` — Super Admin only.
- `PATCH /platform/staff/users/:userId/status` — Super Admin only.

Safety rules: a Super Admin cannot change their own staff role or account status through these endpoints, and LiteHubs cannot be left without a Super Admin.

## Create a Support user in Postman

`POST {{baseUrl}}/platform/staff/users`

```json
{
  "fullName": "Amina Support",
  "email": "amina.support@example.com",
  "password": "StartHere2026",
  "roles": ["platform_support"]
}
```

Use the access token of an existing `platform_super_admin` account as Bearer Token. The new user changes their password at first login.

## Staff console screens

The LiteHubs Staff console uses its own `/platform` shell and its own navigation.
It never uses the `/[orgSlug]` company workspace shell.

| Screen                          | Route                           | Who can open it                                                                                  |
| ------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------ |
| Platform overview               | `/platform`                     | Any LiteHubs staff role; widgets appear only when the role has the matching platform permission. |
| Organization registry           | `/platform/organizations`       | `platform.organizations.read`                                                                    |
| Organization account detail     | `/platform/organizations/:slug` | `platform.organizations.read`                                                                    |
| Suspend/reactivate organization | organization detail             | `platform.organizations.update`                                                                  |
| Subscription registry           | `/platform/subscriptions`       | `platform.subscriptions.read`                                                                    |
| Industry catalogue              | `/platform/industries`          | `platform.industries.read`                                                                       |
| Staff management                | `/platform/staff`               | Platform Super Admin only                                                                        |

The overview shows company count, company status, subscription plan totals,
recent registrations, and industry counts. It does not show the internal
operations of a customer company.

## Scope and safety

A platform staff account can see account-level registry data only: company name,
workspace address, country, status, creation date, and subscription details
when its role is allowed to read subscriptions.

It cannot read customer employees, farms, livestock, attendance, payroll,
projects, expenses, production, or business documents. The database policies
in migration `033_platform_cross_tenant_read.sql` grant only the narrow
organization and subscription registry access needed by this console.

A module enable/disable catalogue is deliberately not shown yet. LiteHubs does
not yet have a module catalogue and per-company module activation table/API;
showing a switch that does not change access would be misleading. Build that as
a separate, audited platform feature when module subscription control is ready.
