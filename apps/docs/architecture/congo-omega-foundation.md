# Congo Omega foundation

## Account emails (built)

LiteHubs now sends responsive, branded Congo Omega emails with a clear action
button, a plain-text version for all email readers, a safe copy-and-paste link,
and mobile-friendly layout. User-provided names and company names are HTML
escaped before they appear in an email.

| Event                         | Recipient                | Email                                                      |
| ----------------------------- | ------------------------ | ---------------------------------------------------------- |
| A company is registered       | The new company owner    | Welcome email with sign-in link and workspace name         |
| A team invitation is accepted | The new team member      | Welcome email with sign-in link and workspace name         |
| A team invitation is created  | Invited email address    | Invitation email with accept link                          |
| Password reset requested      | Registered account email | Secure reset email, valid for 60 minutes and usable once   |
| Password is changed or reset  | The account email        | Security confirmation email; other sessions are signed out |

An employee profile alone does not receive a welcome email because an employee
can exist without a LiteHubs login. When that employee needs access, an owner
or manager creates a team invitation; after the person accepts it and creates
their account, they receive the welcome email automatically.

Passwords are deliberately never included in any email, subject line, preview
text or log. The account holder chooses their own password at registration or
while accepting an invitation. Reset links are opaque, expire after one hour,
and cannot be reused.

To test with real email delivery:

1. Restart the API after the SMTP configuration is saved.
2. Register a new test company with a new email address, or send and accept a
   team invitation with a new email address.
3. Check the inbox for the welcome email.
4. Use `POST /api/v1/auth/forgot-password` to verify the reset design. Do not
   share the reset token with anyone.

No database migration is needed for these emails. Automated tests deliberately
skip external email sending.

## Purpose

This document records the additive Congo Omega work built on top of LiteHubs.

LiteHubs remains the platform. Congo Omega is the first Mixed Farm company on
the platform. The work below does not rewrite the project, change the current
Owner permissions, or add payments, finance, sales, or subscriptions.

## Location structure

Congo Omega can now be arranged like this:

```
Congo Omega company
  -> Province
    -> Site or farm
      -> Department
        -> Members and their roles
```

The company country and company address already belong to the organization
profile. The new foundation adds these company-owned records:

| Record              | What it is for                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Province            | A Congo Omega operating province, such as a province managed by a local team.                                               |
| Site                | A farm, office, warehouse, or other company location. Every site belongs to one province.                                   |
| Department          | A team such as Human Resources, Poultry, Pigs, Agriculture, or Operations. It may belong to a site or to the whole company. |
| Province assignment | The explicit list of provinces a member may manage or work in.                                                              |

Each record belongs to one organization and has tenant isolation. A site in
Congo Omega cannot point to a province belonging to another LiteHubs company.

## Congo Omega roles

The following roles are available for a new Mixed Farm company and are also
seeded into existing Mixed Farm companies after the role seed is run.

| Role                    | Scope              | Main access                                                                                                               |
| ----------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Owner                   | Whole company      | The creator and highest authority. Its current full-permission behavior is unchanged.                                     |
| General Manager         | Whole company      | Current broad organization access, including all current modules.                                                         |
| Provincial Manager      | Assigned provinces | Reads Poultry, Pigs, Agriculture and supporting people/operations information; manages daily work and operational alerts. |
| Farm Operations Manager | Whole company      | Runs Poultry, Pigs and Agriculture across all Congo Omega sites. No finance or sales permissions.                         |
| Poultry Supervisor      | Assigned provinces | Creates, reads and updates Poultry records plus the daily work needed to supervise staff.                                 |
| Pig Supervisor          | Assigned provinces | Creates, reads and updates Pig records plus the daily work needed to supervise staff.                                     |
| Agriculture Supervisor  | Assigned provinces | Creates, reads and updates Agriculture records plus the daily work needed to supervise staff.                             |
| HR Officer              | Whole company      | Employees, attendance, shifts, leave, training, discipline, documents and contracts.                                      |
| Veterinarian            | Assigned provinces | Animal health, treatment, vaccination, quarantine and biosecurity work.                                                   |
| Agronomist              | Assigned provinces | Crops, fields, scouting and agronomy work.                                                                                |
| Employee                | Own work           | Own attendance and assigned daily work.                                                                                   |

The existing Site Manager, Supervisor, Storekeeper and Security Officer roles
are now labelled as province-scoped. Their already-existing permission lists
were not changed.

## Roles, permissions and location access

These three things work together:

1. A **role** says what type of work a person can do.
2. A **permission** says which action is allowed, such as reading Poultry flocks
   or updating Pig weights.
3. A **scope** says where the role applies: the whole company, assigned
   provinces, or the member's own work.

Example: a Poultry Supervisor is given the Poultry Supervisor role and is
assigned to Kinshasa province. They should work only with Congo Omega Poultry
data in Kinshasa, not Pig or Agriculture data and not other provinces.

A person can have more than one role. For example, one Farm Operations Manager
can run Poultry, Pigs and Agriculture across the whole company.

## What was added

- The existing local Congo Omega company is configured as `mixed_farm`, so it
  receives the Poultry, Pigs and Agriculture role template.
- Database migration: `database/migrations/008_congo_omega_structure.sql`
  - role scope field
  - provinces
  - sites/farms
  - departments
  - member-to-province assignments
  - row-level organization isolation for every new table
- Role seed: `database/seeds/role-presets.sql`
  - Provincial Manager
  - Farm Operations Manager
  - Poultry Supervisor
  - Pig Supervisor
  - Agriculture Supervisor
  - permission bundles for each role
  - automatic synchronization of the five new roles into existing Mixed Farm companies
- Company provisioning now copies a role's scope when a company is created.
- Company Setup and Team Management API:
  - provinces, farms/sites and departments
  - roles and permission catalogue
  - custom roles created by the company owner
  - member role and province assignments
  - team invitation, revocation and acceptance
  - province filtering for provinces, sites and departments
- Database migrations `009` to `011`: invitation province assignments and
  secure, atomic invitation acceptance.

## What has not been changed

This is important so the system is understood correctly:

- The Owner role still receives every currently catalogued permission. Restricting
  Owner permissions to only enabled Congo Omega modules is deliberately left
  for a later module-template step.
- General Manager retains its current broad access. This supports the requested
  country-wide manager.
- Payments, finance, sales, subscriptions and the general LiteHubs project
  structure were not changed.
- Province, site, department, team, role and invitation API endpoints are built.
  Dashboard screens are still not built.
- Province scope is enforced now for provinces, sites and departments.
  Poultry, Pig, Agriculture and HR records do not exist yet, so every future
  record endpoint must apply the same province-assignment rule.

## Next build order

1. Build employee profiles, then connect them to members, departments and sites.
2. Build shifts and attendance.
3. Build Poultry records: houses, flocks, feed, mortality, eggs, health and
   vaccines.
4. Build Pig records: pens, animals, feed, weights, breeding and health.
5. Build Agriculture records: farms, fields, crops, inputs, activities and
   harvest.
6. Enforce province scope on every list, detail, create, update and delete
   operation for each new record type.
7. Add the simple Congo Omega dashboard and navigation that shows only the
   areas enabled for the company and the logged-in role.

## How Congo Omega will be set up

1. The owner creates Congo Omega as a Mixed Farm company.
2. The owner creates the provinces where Congo Omega operates.
3. The owner creates a site/farm inside each province.
4. The owner creates departments, for example HR, Poultry, Pigs and
   Agriculture.
5. The owner invites team members.
6. The owner assigns one or more roles to each team member.
7. The owner assigns provincial managers, supervisors and employees to the
   provinces they are allowed to access.

## Company Setup API and Postman

Import the ready-made Postman collection:
[`docs/api/congo-omega-setup.postman_collection.json`](../api/congo-omega-setup.postman_collection.json).
Set its `ownerPassword` variable, then run the requests in order. It creates
unique test data and checks the province-limited Poultry Supervisor flow
automatically.

These routes are live under:

```text
http://localhost:5000/api/v1
```

For owner-only setup requests, add this header:

```text
Authorization: Bearer OWNER_ACCESS_TOKEN
Content-Type: application/json
```

Use the Congo Omega slug in every company route:

```text
/organizations/congo-omega/...
```

### 1. Check the company roles

```text
GET /organizations/congo-omega/roles
```

This lists the built-in Congo Omega roles, including
`poultry_supervisor`, `pig_supervisor`, `agriculture_supervisor`,
`provincial_manager` and `farm_operations_manager`.

To see the permission catalogue before making a custom role:

```text
GET /organizations/congo-omega/permissions
```

### 2. Create a province

```text
POST /organizations/congo-omega/provinces
```

```json
{
  "code": "kinshasa",
  "name": "Kinshasa"
}
```

Save the returned `province.id`. It is needed when creating farms/sites and
when inviting a province-limited supervisor.

### 3. Create a farm or site

```text
POST /organizations/congo-omega/sites
```

```json
{
  "provinceId": "PROVINCE_ID_FROM_THE_PREVIOUS_RESPONSE",
  "code": "kinshasa_farm",
  "name": "Kinshasa Farm",
  "siteType": "farm",
  "city": "Kinshasa"
}
```

A site type may be `farm`, `office`, `warehouse` or `other`.

### 4. Create a department

```text
POST /organizations/congo-omega/departments
```

```json
{
  "siteId": "SITE_ID_FROM_THE_PREVIOUS_RESPONSE",
  "code": "poultry",
  "name": "Poultry"
}
```

A department can be company-wide by leaving out `siteId`. Company-wide
departments require an Owner or another company-wide role.

### 5. Invite a Poultry Supervisor

```text
POST /organizations/congo-omega/invitations
```

```json
{
  "email": "poultry.supervisor@example.com",
  "roleCodes": ["poultry_supervisor"],
  "provinceIds": ["PROVINCE_ID_FROM_THE_PREVIOUS_RESPONSE"],
  "jobTitle": "Poultry Supervisor"
}
```

An invitation is valid for seven days. It stores both the role and the
province assignment before the person accepts.

In local development, the response includes `acceptUrl`. Use that link only
for testing; it is a private one-time invitation link. In production it is sent
by email and is not returned in the API response.

The current SMTP login error means email delivery can fail locally. The
invitation is still created, and the local `acceptUrl` lets Postman testing
continue.

### 6. Accept the invitation and create the employee account

Copy the `token` value from the local `acceptUrl`, then call:

```text
POST /auth/accept-invitation
```

```json
{
  "token": "TOKEN_FROM_ACCEPT_URL",
  "fullName": "Poultry Supervisor Name",
  "email": "poultry.supervisor@example.com",
  "password": "SecurePass123"
}
```

This creates the person account and joins them to Congo Omega in one action.
The response contains their access token and their assigned role.

### 7. Confirm province-limited access

Use the invited person's access token:

```text
GET /organizations/congo-omega/provinces
GET /organizations/congo-omega/sites
GET /organizations/congo-omega/departments
```

They receive only records in their assigned province. An Owner or Farm
Operations Manager receives all company records.

### Change an existing member

The Owner can replace a member's role assignments:

```text
PUT /organizations/congo-omega/members/MEMBER_ID/roles
```

```json
{
  "roleCodes": ["poultry_supervisor"]
}
```

The Owner can replace their province assignments:

```text
PUT /organizations/congo-omega/members/MEMBER_ID/provinces
```

```json
{
  "provinceIds": ["PROVINCE_ID"]
}
```

Use `GET /organizations/congo-omega/members` to find `MEMBER_ID`.

### Endpoint reference

| Area                  | Routes                                                                         |
| --------------------- | ------------------------------------------------------------------------------ |
| Provinces             | List, create, update and delete `/organizations/:orgSlug/provinces`            |
| Sites/farms           | List, create, update and delete `/organizations/:orgSlug/sites`                |
| Departments           | List, create, update and delete `/organizations/:orgSlug/departments`          |
| Roles                 | List/create `/organizations/:orgSlug/roles`; update/delete a custom role by ID |
| Permissions           | List `/organizations/:orgSlug/permissions`                                     |
| Members               | List members, replace member roles, replace member provinces                   |
| Invitations           | List, create and revoke `/organizations/:orgSlug/invitations`                  |
| Invitation acceptance | `POST /auth/accept-invitation`                                                 |

Built-in Congo Omega roles are protected from editing or deletion. An Owner can
create, update and delete custom company roles, but cannot give a custom role a
permission that the Owner does not hold.

## Employee profiles (built)

Database migrations `012_employee_profiles.sql`, `013_automatic_employee_numbers.sql` and `014_five_digit_employee_numbers.sql` add an employee profile for each
Congo Omega worker. An employee profile is not the same thing as a login or a
role:

| Item             | Meaning                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------- |
| User account     | Lets a person sign in to LiteHubs.                                                           |
| Company member   | Connects that user account to Congo Omega.                                                   |
| Role             | Says what the member can do, for example Poultry Supervisor.                                 |
| Employee profile | Stores the HR record: employee number, job title, work location, status and contact details. |

An employee can be created without a user account, for workers who do not log
in. If they later need access, the Owner first invites them to Congo Omega, then
links their active company member record to their employee profile.

Employee work location and member access are checked separately. A member's
province assignment says where they may use the system. The employee profile's
province, farm and department say where that person works. If a farm or a
farm-based department is selected, LiteHubs automatically sets the employee's
province from that farm, so conflicting location data cannot be saved.

### Employee Profile API

The following routes are live:

```text
GET    /organizations/congo-omega/employees
POST   /organizations/congo-omega/employees
GET    /organizations/congo-omega/employees/EMPLOYEE_ID
PATCH  /organizations/congo-omega/employees/EMPLOYEE_ID
DELETE /organizations/congo-omega/employees/EMPLOYEE_ID
```

Create a profile for an invited Poultry Supervisor:

```json
{
  "memberId": "MEMBER_ID_FROM_GET_MEMBERS",
  "fullName": "Poultry Supervisor Name",
  "jobTitle": "Poultry Supervisor",
  "departmentId": "POULTRY_DEPARTMENT_ID",
  "employmentStatus": "active",
  "employmentType": "permanent",
  "startDate": "2026-08-23",
  "phone": "+243800000001"
}
```

LiteHubs generates exactly five digits, with no text prefix.
`10001` to `19999` are employees; `20001` to `29999` are supervisors.
`30001` to `39999` are officers; `40001` to `49999` are managers.
The first digit is a quick category label for the employee portal or clock-in.
Roles, not the employee number, control access to LiteHubs.

For a linked member, LiteHubs derives the category from their role. For a worker
without a login, send `"positionCategory": "supervisor"` when appropriate.

`memberId` is optional. Leave it out for an employee with no LiteHubs login.
When `departmentId` belongs to a farm, no `siteId` or `provinceId` is needed:
the server safely derives both values. If you supply `provinceId`, it must match
the selected farm's province.

Owners and company-wide roles can list every employee. Province-scoped members
see only employee profiles located in their assigned provinces; a profile from
another province is returned as `404 Not Found`.

The integration test creates employees in Kinshasa and Kongo Central, then
confirms a Kinshasa Poultry Supervisor sees only the Kinshasa employee.

## Shifts and attendance (built)

A ready-to-import Postman collection is available at
`docs/api/congo-omega-attendance.postman_collection.json`. It creates its own
test data and runs the whole attendance process from login through approval.

Shifts and attendance are now connected to the employee profile and the farm
structure. The operational flow is:

```text
Province → farm/site → shift → employee assignment → five-digit employee number → attendance record
```

The Owner, HR Officer and company-wide managers create the shift and assign the
employee. A province-limited supervisor can see and record attendance only for
employees in their assigned province. They cannot clock in a worker from another
province.

### Set up a shift

First create the employee profile, including their farm or department. Then use
an Owner, HR Officer or manager token to create the schedule:

```text
POST /organizations/congo-omega/shifts
```

```json
{
  "code": "poultry_morning",
  "name": "Poultry Morning",
  "siteId": "FARM_SITE_ID",
  "departmentId": "POULTRY_DEPARTMENT_ID",
  "startsAt": "06:00",
  "endsAt": "14:00"
}
```

The `code` must be unique within Congo Omega and use lowercase letters,
numbers and underscores. The selected department, when supplied, must belong to
the same farm. The farm automatically decides the shift province.

Then assign an employee to that shift:

```text
POST /organizations/congo-omega/shifts/SHIFT_ID/assignments
```

```json
{
  "employeeId": "EMPLOYEE_ID",
  "effectiveFrom": "2026-08-24"
}
```

An employee can only be assigned to a shift in their own work province. An
employee cannot have overlapping active shift assignments. Use `effectiveTo`
when an assignment has an end date.

### Record attendance with the employee number

After the assignment exists, use the five-digit employee number to clock in:

```text
POST /organizations/congo-omega/attendance/clock-in
```

```json
{
  "employeeNumber": "10001",
  "workDate": "2026-08-24",
  "occurredAt": "2026-08-24T06:05:00Z"
}
```

`occurredAt` is optional: if it is left out, LiteHubs uses the current time.
The same number and work date are used to clock out:

```text
POST /organizations/congo-omega/attendance/clock-out
```

```json
{
  "employeeNumber": "10001",
  "workDate": "2026-08-24",
  "occurredAt": "2026-08-24T14:00:00Z"
}
```

LiteHubs keeps one attendance record per employee per work date. Clock-out
updates that same record. The system marks a clock-in more than 15 minutes
after the scheduled shift start as `late`.

### Attendance routes and controls

```text
GET    /organizations/congo-omega/shifts
PATCH  /organizations/congo-omega/shifts/SHIFT_ID
DELETE /organizations/congo-omega/shifts/SHIFT_ID
GET    /organizations/congo-omega/shifts/SHIFT_ID/assignments
POST   /organizations/congo-omega/shifts/SHIFT_ID/assignments
GET    /organizations/congo-omega/attendance?workDate=YYYY-MM-DD
PATCH  /organizations/congo-omega/attendance/ATTENDANCE_ID
POST   /organizations/congo-omega/attendance/ATTENDANCE_ID/approve
```

Corrections require a short `correctionNote`, so the change is traceable. The
Owner, HR Officer and managers can approve records. A Poultry Supervisor can
read, clock workers and correct records in their province, but cannot create a
shift, assign staff or approve attendance.

Employees without a LiteHubs login can be clocked by a supervisor using their
five-digit number. An employee with a linked login may clock themselves only if
their role has the `attendance.clock_self` permission.

## Poultry operations and mortality control (built)

Poultry operations are fully connected to the Congo Omega company structure:

```text
Province → farm/site → poultry house → flock → operational records
```

Houses belong to a farm. Flocks belong to a house. Every feed, water, health,
vaccination, egg, weight, sanitation, biosecurity, loss and mortality record
belongs to a flock or house. LiteHubs derives the province from that chain, so
a provincial supervisor cannot read or enter information for another province.

The ready-to-import test collection is at
`docs/api/congo-omega-poultry.postman_collection.json`. Set only the Owner
email and password, then run it from top to bottom. It creates its own farm,
house and flock without changing an existing Congo Omega flock.

### Mortality is the source of truth

Deaths are entered **only** as a detailed mortality record. The daily record
does not ask the user to type a second mortality number. It automatically shows
the total deaths that were recorded for that flock and date. This prevents the
same deaths being counted twice.

For every mortality event, record the number of birds, the likely cause,
clinical signs, postmortem and disposal information, veterinarian, follow-up
decision and notes. For example:

```text
POST /organizations/congo-omega/poultry/mortality
```

```json
{
  "flockId": "FLOCK_ID",
  "mortalityDate": "2026-08-25",
  "deathCount": 3,
  "causeCategory": "disease",
  "suspectedCause": "Respiratory disease",
  "clinicalSigns": "Coughing and reduced feed intake",
  "postmortemStatus": "pending",
  "disposalMethod": "incineration",
  "veterinarianName": "Dr. Example",
  "requiresFollowUp": true,
  "followUpStatus": "pending",
  "followUpNotes": "Veterinary inspection before the next shift"
}
```

Each flock has a daily mortality review threshold. It starts at `1`, meaning
that even one death is visible for review. The Owner or manager can set a
different threshold when creating or updating a flock. The overview returns a
`mortalityReview` list containing every flock/day that reached its threshold.

```text
GET /organizations/congo-omega/poultry/overview?from=YYYY-MM-DD&to=YYYY-MM-DD
```

Use this as the daily management review. It includes the death total, mortality
rate, live bird count, threshold, follow-up status and the farm location.
This version makes the problem visible and traceable; automatic email or SMS
alerts are a future addition.

### Poultry API routes

All Poultry resources use the same safe route pattern:

```text
GET, POST                     /organizations/congo-omega/poultry/RESOURCE
GET, PATCH, DELETE            /organizations/congo-omega/poultry/RESOURCE/RECORD_ID
```

`RESOURCE` can be `houses`, `flocks`, `daily-records`, `mortality`, `feed`,
`water`, `weights`, `eggs`, `health`, `vaccinations`, `treatments`,
`sanitation`, `biosecurity`, `production-targets` or `losses`.

The normal operating sequence is:

1. Create a poultry house with its `siteId` and capacity.
2. Create a flock with its `houseId`, bird type, production type, arrival or
   hatch date, initial bird count and mortality-review threshold.
3. Record daily feed, water, weights, eggs and the daily flock count.
4. Enter every death through `mortality`, with the investigation and
   follow-up details.
5. Record health, vaccinations, treatments, sanitation and biosecurity checks.
6. Review the overview each day and resolve follow-up items.

### Poultry access rules

The Owner and company-wide managers can work with every farm. A Poultry
Supervisor can create, read and update Poultry records only in the provinces
assigned to them. They cannot delete records. Employees without a poultry
management role do not receive Poultry access. The API checks these rules on
list, detail, create, update and delete operations.

## Poultry performance models and daily work (built)

Poultry is now model-driven. LiteHubs does **not** contain one fixed formula
for every chicken. Congo Omega creates and maintains its own performance
models, for example:

```text
Cobb 500 Broiler
Ross 308 Broiler
Lohmann Brown Layer
ISA Brown Layer
Congo Omega Custom Model
```

Each model is either a `broiler` or `layer` model. Each week is editable, so
the company decides its own target weight, feed per bird per day, water per
bird per day, expected cumulative mortality, egg lay rate, rejected-egg limit
and tolerance. The system calculates against these values only after an admin
has created them.

The complete test collection is at
`docs/api/congo-omega-poultry-performance.postman_collection.json`.

### The production calculation flow

```text
Flock / batch
  → performance model and climate profile
  → bird age and week calculated from hatch or arrival date
  → weekly target and vaccine schedule
  → actual daily feed, water, weight, mortality and eggs
  → comparison, recommendations and daily work items
```

When an admin creates a flock, they add its initial bird number, production
type (`broiler` or `layer`) and `performanceModelId`. The model must match the
flock type. LiteHubs calculates the age in days and current week automatically
from `hatchDate`, or `arrivalDate` when a hatch date is not known.

### Regions and climate profiles

A climate profile can be attached to a province and then selected on a
performance model. It records country, climate type, season, temperature,
humidity, water adjustment, feed adjustment and an operating note.

For example, a Kinshasa hot/humid profile can use a `waterAdjustmentPercent`
of `10`. A model target of `0.30` litres per bird for 98 live birds becomes a
daily water requirement of `32.34` litres. The adjustment is editable by
Congo Omega—LiteHubs does not guess a climate formula.

```text
POST /organizations/congo-omega/poultry/climate-profiles
```

```json
{
  "code": "kinshasa_hot_humid",
  "name": "Kinshasa Hot/Humid",
  "provinceId": "KINSHASA_PROVINCE_ID",
  "climateClass": "hot_humid",
  "temperatureC": 31,
  "humidityPercent": 78,
  "waterAdjustmentPercent": 10,
  "feedAdjustmentPercent": 0,
  "operationalNote": "Keep cool water available and inspect ventilation."
}
```

### Create a model, weekly targets and vaccines

Create the company model:

```text
POST /organizations/congo-omega/poultry/performance-models
```

```json
{
  "code": "congo_broiler_a",
  "name": "Congo Omega Broiler A",
  "productionType": "broiler",
  "strain": "Congo Omega Custom",
  "climateProfileId": "CLIMATE_PROFILE_ID"
}
```

Add an editable weekly target:

```text
POST /organizations/congo-omega/poultry/performance-models/MODEL_ID/weekly-targets
```

```json
{
  "weekNumber": 1,
  "targetWeightG": 500,
  "feedGPerBirdPerDay": 100,
  "waterLitersPerBirdPerDay": 0.3,
  "expectedCumulativeMortalityPercent": 1,
  "maxRejectedEggPercent": 1,
  "tolerancePercent": 5
}
```

Use the model’s vaccine schedule instead of typing a future date on every
flock. `dayAge: 0` means the vaccine is due at the start of the flock.

```text
POST /organizations/congo-omega/poultry/performance-models/MODEL_ID/vaccine-schedules
```

### Daily calculation, eggs and assigned work

Read the complete daily result for one flock:

```text
GET /organizations/congo-omega/poultry/flocks/FLOCK_ID/performance?date=YYYY-MM-DD
```

The result contains the live bird balance, expected versus actual feed and
water, current weight compared to target, cumulative mortality compared to the
model limit, egg lay rate and the egg-quality calculation:

```text
broken eggs   = cracked eggs
rejected eggs = cracked + dirty + separately rejected eggs
saleable eggs = total - rejected eggs - hatching eggs
```

`rejectedEggs` is now accepted when entering an egg record. This makes broken
and rejected eggs visible in performance recommendations.

Generate the current model’s daily work items:

```text
POST /organizations/congo-omega/poultry/flocks/FLOCK_ID/daily-work/generate
```

```json
{
  "workDate": "2026-08-25",
  "assignedMemberId": "OPTIONAL_MEMBER_ID"
}
```

LiteHubs creates non-duplicate feed, water, weighing, egg collection,
mortality review, climate check and due-vaccination jobs. The owner or
supervisor can assign a worker and mark each work item as `planned`,
`in_progress`, `completed` or `skipped`.

Owners, General Managers, Farm Operations Managers and Site Managers can edit
models and climate profiles. Poultry Supervisors, provincial managers and
veterinarians can read the models and use the calculations for farms in their
assigned provinces.

## Pig farm operations (built)

The Pig module is now ready for Congo Omega. It records animals individually
when a pig needs a full history, such as a sow or boar, and records groups
when the farm works with a batch. An ear tag is optional during registration;
when it is entered, it must be unique within the company.

```text
Province -> Farm/site -> Pig pen -> group and/or animal
                              -> daily balance, feed, water, weights
                              -> movement, mortality, operational loss
                              -> breeding -> pregnancy -> farrowing -> piglets
                              -> health, vaccination, treatment, veterinary, quarantine
```

### Setup and daily production

Create a site first, then create the pens inside it. Each pen has a type and
capacity, including gestation, farrowing, nursery, grower, finisher, boar,
hospital and quarantine. A group belongs to one pen; each individual animal
also belongs to one pen and can optionally belong to a group.

Daily records capture the opening and closing balance. Feed, water and
weight records are independent entries so the farm can enter them as work is
completed. A movement changes the animal or group's current pen
automatically. An individual mortality record changes that animal to
`deceased`; the history is kept and is never erased.

### Breeding and health

Breeding accepts a female sow/gilt and a male boar only. A confirmed pregnancy
changes the sow status to `pregnant`. After the sow is moved to a farrowing
pen, recording the farrowing changes her status to `lactating` and closes
the linked pregnancy as `farrowed`. Piglet records preserve the born,
live-born, stillborn, mummified and sex totals.

Health records, vaccinations, treatments, veterinary visits and quarantine
all attach to the correct pen, group or individual animal. A quarantine
record changes an individual animal status to `quarantined` while it is
active. Operational losses record non-animal losses such as damaged feed or
equipment.

### Access and provincial control

Owners and company-wide managers can work with all Pig farms. Pig Supervisors
can create, read and update Pig records in their assigned provinces; they
cannot delete records. Veterinarians receive the health, vaccination,
treatment, quarantine, veterinary and mortality permissions. Every lookup
checks that linked records belong to the same company and are inside the
user's permitted province.

### Main Pig API

```text
GET  /organizations/congo-omega/pigs/overview
GET  /organizations/congo-omega/pigs/animals?penId=PEN_ID
POST /organizations/congo-omega/pigs/pens
POST /organizations/congo-omega/pigs/groups
POST /organizations/congo-omega/pigs/animals
POST /organizations/congo-omega/pigs/daily-records
POST /organizations/congo-omega/pigs/feed
POST /organizations/congo-omega/pigs/water
POST /organizations/congo-omega/pigs/weights
POST /organizations/congo-omega/pigs/movements
POST /organizations/congo-omega/pigs/mortality
POST /organizations/congo-omega/pigs/losses
POST /organizations/congo-omega/pigs/breeding
POST /organizations/congo-omega/pigs/pregnancies
POST /organizations/congo-omega/pigs/farrowing
POST /organizations/congo-omega/pigs/piglets
POST /organizations/congo-omega/pigs/health
POST /organizations/congo-omega/pigs/vaccinations
POST /organizations/congo-omega/pigs/treatments
POST /organizations/congo-omega/pigs/quarantine
POST /organizations/congo-omega/pigs/veterinary
```

Each resource also supports `GET /:recordId`, `PATCH /:recordId`, and
`DELETE /:recordId` when the user has the matching read, update or delete
permission. The ready-to-import full workflow test is
`docs/api/congo-omega-pigs.postman_collection.json`.

## Agriculture operations (built)

The Agriculture module is now ready for Congo Omega. It uses one location
chain for every crop record, so managers and supervisors see only the farms in
their assigned provinces.

```text
Province -> Site -> Agriculture farm -> Field -> Plot
                                             -> Crop + Season
                                             -> Planting / crop cycle
                                             -> daily work, inputs and scouting
                                             -> harvest, target and loss
```

### Farm setup and crop cycle

The company creates a site first, then an Agriculture Farm inside that site.
The farm contains fields, and a field contains plots. Fields store area, soil,
irrigation source and optional GPS coordinates. Plots store their own area and
current state, such as available, planted, fallow or resting.

The crop catalogue is company-owned and contains crop type, variety, default
growing days and yield unit. A season belongs to one farm. A planting joins a
plot, crop and optional season, with planted area, seed quantity, planting
method, expected harvest date and cycle status.

When a planting is marked as `planted` or `growing`, LiteHubs marks its plot
as planted. When a harvest is recorded, LiteHubs automatically marks the crop
cycle as `harvested` and saves its actual harvest date.

### Daily work, inputs and crop health

Operations are daily agricultural work such as land preparation, planting,
weeding, pruning, mulching and inspection. They can record labour hours,
equipment and quantities. Irrigation records method, water volume and
duration. Fertilizer records product, nutrient formula and quantity. Pesticide
records product, target pest, dosage and pre-harvest interval.

Field scouting records pests, disease, weeds, nutrient deficiency, water
stress, growth, soil and weather damage with a severity, recommendation and
follow-up state. Farm weather records rainfall, temperature, humidity, wind
and conditions. All these entries may be connected to a field, plot and crop
cycle so the history remains useful at harvest time.

### Harvest, targets, losses and access

Harvest records quantity, unit, grade, rejected quantity, moisture and storage
location. Production targets attach to a crop cycle and give the expected yield
and target harvest date. Loss records retain crop, pest, drought, flood, fire,
theft, equipment and input-spoilage losses, including quantity and estimated
value.

Owners and company-wide managers can work with every farm. Agriculture
Supervisors, Agronomists, Supervisors and Provincial Managers can create, read
and update records in their assigned provinces; they cannot delete records.
All linked farm, field, plot, season and planting references are checked to
prevent cross-company or cross-province data access.

### Main Agriculture API

```text
GET  /organizations/congo-omega/agriculture/overview
POST /organizations/congo-omega/agriculture/farms
POST /organizations/congo-omega/agriculture/fields
POST /organizations/congo-omega/agriculture/plots
POST /organizations/congo-omega/agriculture/crops
POST /organizations/congo-omega/agriculture/seasons
POST /organizations/congo-omega/agriculture/plantings
POST /organizations/congo-omega/agriculture/operations
POST /organizations/congo-omega/agriculture/irrigation
POST /organizations/congo-omega/agriculture/fertilizer
POST /organizations/congo-omega/agriculture/pesticides
POST /organizations/congo-omega/agriculture/scouting
POST /organizations/congo-omega/agriculture/weather
POST /organizations/congo-omega/agriculture/harvest
POST /organizations/congo-omega/agriculture/production-targets
POST /organizations/congo-omega/agriculture/losses
```

Every resource also supports list, single-record read, update and delete when
the user has the matching permission. Import and run the complete test from
`docs/api/congo-omega-agriculture.postman_collection.json`.

## Owner Management layer (built)

LiteHubs now has the connected Congo Omega management layer. It is separate
from Poultry, Pigs and Agriculture, but it connects to their company
foundation: organization, province, site, department, employee, role and
attendance records.

```text
Project blueprint -> Phases -> Tasks -> Planned budget -> Materials
                                                       -> Purchase request
                                                            -> Approval
                                                            -> Purchase order
                                                                 -> Receipt
                                              consumable  -> Inventory / project material
                                              durable     -> Company asset
                                                                  -> Assignment / usage
                                                                  -> Maintenance plan
                                                                  -> Work order / parts
```

### Projects, tasks and money

A project retains its code, type, blueprint, province/site/department,
responsible person, dates, status, priority, expected budget and progress.
Phases divide a project into ordered steps. Tasks can be assigned to an
employee or department with due date, cost, status, blockage reason and task
dependencies.

Budget lines record the planned amount. The project summary and Owner
Dashboard calculate planned budget, approved/paid spending, outstanding
purchase-order commitment, remaining available budget, utilization percentage,
project progress, overdue tasks and the next action list. No user needs to add
those totals by hand.

### Materials, purchases and receiving

Project materials are consumables such as cement, wire, feed and fuel. Each
one stores planned quantity and cost, supplier and stock location. LiteHubs
calculates requested, approved, ordered, accepted, used, available and still
needed quantity, plus planned and actual cost.

Purchase requests, request lines, approvals, purchase orders, order lines and
receipts are different records on purpose. A receipt line records delivered,
damaged and rejected quantity. Only accepted quantity enters inventory. Each
accepted unit on a durable purchase-order line is automatically registered as
its own permanent company asset. A purchase order changes automatically from sent to partially received or
received as deliveries arrive. Stock and material movements are immutable;
corrections are made by a new adjustment rather than rewriting history.

### Daily work and production control

**Daily Work** is the operational start-of-day and end-of-day workspace. It
combines the human evidence of work with the production records already held by
Poultry, Pigs and Agriculture; it does not duplicate those industry records.
The live overview shows each day’s poultry bird balance and mortality, pig
closing count and mortality, and completed agricultural operations and labour
hours, alongside active alerts and due project actions.

A supervisor can start a site checklist from a reusable template. Each item has
a typed answer (yes/no, number, text, choice or photo reference), pass/fail
result and observation. Required items must be answered before completion. A
failed item attached to a critical control automatically creates a linked alert.
Completed runs are verified by a user with `daily_operations.approve` and then
remain an auditable record.

Daily reports capture the supervisor or manager’s summary, completed work,
problems, help needed and selected production figures. They move from draft or
submitted to reviewed or flagged. Shift handovers record urgent items, remaining
work and equipment condition; the incoming employee acknowledges the handover
rather than silently relying on a verbal message. Every list is restricted by
organization, province or the employee’s own records according to their role.

Main routes:

```text
GET  /organizations/congo-omega/daily-work/overview
GET  /organizations/congo-omega/daily-work/templates
POST /organizations/congo-omega/daily-work/runs
PUT  /organizations/congo-omega/daily-work/runs/:runId/items/:itemId/response
POST /organizations/congo-omega/daily-work/runs/:runId/complete
POST /organizations/congo-omega/daily-work/runs/:runId/verify
POST /organizations/congo-omega/daily-work/reports
POST /organizations/congo-omega/daily-work/reports/:reportId/review
POST /organizations/congo-omega/daily-work/handovers
POST /organizations/congo-omega/daily-work/handovers/:handoverId/acknowledge
```

### Approval workflow

Approvals are a protected decision queue, not a free-text log. When a purchase
request or an expense is submitted, when a maintenance work order is marked
`waiting_approval`, or when a project phase requests completion approval,
LiteHubs creates one pending approval automatically. The database gives it a
company-local reference such as `APP-00001`; no employee has to invent or
remember a number.

Owners and authorized managers decide it as approved, partially approved or
rejected. A rejection must include a reason. The original requested amount and
the approved amount are retained separately, so a partial approval never
rewrites the original request. Approval records are immutable after creation:
the decision, decision maker, timestamp and note form the audit history.

A decision updates the connected operational record: purchase requests move to
approved / partially approved / rejected, expenses are approved or rejected,
maintenance work orders move to approved or back to reported, and an approved
phase-completion request marks the phase complete. Visibility continues to use
organization, province and project scope.

### Assets, vehicles and maintenance

Durable equipment is not a material. Assets receive automatic numbers such as
`AST-00001`, retain supplier/project/location/condition/meter information, and
stay in LiteHubs after a project closes. Assets support assignment, transfers,
machine usage, downtime and meter/fuel records. Vehicle profiles and trips use
the same asset foundation.

Maintenance plans support calendar or meter intervals. Work orders record
reported issue, technician, status, parts, labour, cost, work performed,
recommendation and next due values. Issuing an inventory part to maintenance
reduces stock and updates the work order's parts cost. Completing a service
updates the asset meter and advances its schedule. The Owner Dashboard shows
overdue and due-soon service plans and out-of-service assets.

### Roles and scope

Owner and organization-wide roles see all company records. Provincial roles
are restricted to their assigned provinces. The new Project Manager role has
`project` scope: after the owner adds the person to a project, that manager can
see and work only that project's phases, tasks, materials, purchasing, expenses
and documents. Asset and maintenance visibility is kept with the owner and
organization/province management roles until a company deliberately adds it.
Employee numbers remain only a human identifier; permissions still come from
roles and scope.

### Main API

```text
GET  /organizations/congo-omega/owner-management/dashboard
GET  /organizations/congo-omega/owner-management/projects/:projectId/summary
POST /organizations/congo-omega/owner-management/projects
POST /organizations/congo-omega/owner-management/phases
POST /organizations/congo-omega/owner-management/tasks
POST /organizations/congo-omega/owner-management/budget-lines
POST /organizations/congo-omega/owner-management/materials
POST /organizations/congo-omega/owner-management/purchase-requests
POST /organizations/congo-omega/owner-management/purchase-orders
POST /organizations/congo-omega/owner-management/receipts
POST /organizations/congo-omega/owner-management/assets
POST /organizations/congo-omega/owner-management/maintenance-plans
POST /organizations/congo-omega/owner-management/maintenance-work-orders
POST /organizations/congo-omega/owner-management/expenses
GET  /organizations/congo-omega/owner-management/approvals
POST /organizations/congo-omega/owner-management/approvals/:recordId/decide
```

All management resources also support list, single-record read, update and
delete where the matching permission permits it. Ledger and history records
(receipts, stock/material movements, asset usage, vehicle trips and maintenance
parts) are intentionally immutable. Image attachments now use one controlled
Cloudinary upload flow across Owner Management, Poultry, Pigs and Agriculture.
An image is linked to its organization and exact record, and the user must have
read access to list it or update access to add/delete it. JPEG, PNG, WebP, GIF,
HEIC and HEIF are accepted after signature verification; the API secret never
reaches the browser. See `docs/api/image-uploads.md` for setup and Postman use.
General document-link records remain available for future confidential-document
storage without changing the project records.

Use the ready-to-import workflow in
`docs/api/congo-omega-owner-management.postman_collection.json`.

## Updated next build order

Employee Profiles, shifts, attendance, Poultry performance, Pig operations,
Agriculture operations, Owner Management, the role dashboards and the live
Alerts workspace are complete. The next work is:

1. Add the next automatic signals: feed and water variance, egg-quality variance,
   budget overruns, stock shortages and absence/no-show checks.
2. Replace each remaining navigation placeholder with its full records screen,
   starting with the most-used poultry operations.

## Alerts workspace (implemented)

The Alerts workspace is now available at `/{organizationSlug}/alerts`. It is a
live operational control centre, not a placeholder: it lists company alerts in
severity and due-date order, lets authorized users filter and inspect an alert,
raise a manual alert, acknowledge it, start work, resolve or dismiss it with an
auditable note, and delete a manual test/error alert. Automated alerts cannot
be deleted because they are part of the operational audit trail.

The API is tenant-isolated and province-scoped. Owners and organization-wide
managers see their whole company. Provincial roles see only alerts linked to
their assigned provinces, and a provincial role must choose one of those
provinces when raising a manual alert.

```text
GET    /organizations/:orgSlug/alerts
POST   /organizations/:orgSlug/alerts
POST   /organizations/:orgSlug/alerts/evaluate
GET    /organizations/:orgSlug/alerts/:alertId
PATCH  /organizations/:orgSlug/alerts/:alertId
POST   /organizations/:orgSlug/alerts/:alertId/acknowledge
POST   /organizations/:orgSlug/alerts/:alertId/resolve
POST   /organizations/:orgSlug/alerts/:alertId/dismiss
DELETE /organizations/:orgSlug/alerts/:alertId
```

Import `docs/api/congo-omega-alerts.postman_collection.json` to test the full
workflow. `POST /organizations/:orgSlug/alerts/evaluate` now scans existing
company data and the same engine runs after a relevant live record is created
or updated. It creates one deduplicated system alert for each active signal:
poultry mortality, health, below-model weight and overdue vaccines; pig
mortality and health; high-severity field scouting and crop losses; overdue
maintenance plans; and overdue project tasks. Poultry model checks use the
company's editable selected model, never a hard-coded standard.

## Poultry workspace (implemented)

`/{organizationSlug}/poultry` is now the operational Poultry workspace. It uses the existing tenant-isolated and scope-aware Poultry API; no production totals are copied into the browser.

- A daily production cockpit loads the available Poultry records for houses, flocks, daily counts, feed, water, weights, eggs, mortality, health, vaccinations, treatments, sanitation, biosecurity, targets and losses.
- Authorized team members can record live birds, feed, water, sample weights, eggs and mortality from the page. The API still enforces the specific resource permission for every submission.
- A flock performance view calls the performance model API for the chosen date and displays age, live-bird count, climate/model context, target comparison, recommendations, due vaccines and generated model work. Completion is written back to the daily-work endpoint.
- The health and biosecurity view makes recent health, vaccinations, treatments, sanitation, biosecurity and loss records visible without mixing them into one generic list.
- The configuration view shows the organization’s houses, active flocks, performance models and weekly targets. Province and site scope remains enforced by the API for every manager and supervisor.

### Poultry province filter

The Poultry workspace now gives an owner or organization-wide manager an **All provinces / Province** selector. Changing it filters the overview totals, houses, flocks, daily production, health, biosecurity, losses and performance selection together. A second **All production / Broiler / Layer** selector keeps broiler and layer operational data, performance models and weekly targets separate; the combined choice is available only for an intentional company-wide overview. It uses the server-side `provinceId` query parameter on `GET /organizations/:orgSlug/poultry/overview` and all Poultry list routes. A provincial user is still returned only their assigned provinces, and requesting a province outside their scope returns no records.

## Poultry daily management (implemented)

Poultry has moved from a reporting screen to a controlled daily work cycle.
Migration `037_poultry_daily_management.sql` adds temperature and humidity to
poultry daily records, completion and review metadata to generated flock work,
and an immutable work-review history. Existing employee roles receive only the
Poultry daily-record read/update permissions needed for their own assigned work;
they do not receive flock-management access.

- A daily count can now include live birds, arrivals, transfers, culls,
  temperature, humidity, notes, the recorded user, and the time of the entry.
- The Production screen distinguishes a genuine zero from missing information:
  feed, water, eggs, mortality, weight and **Today's bird count** show **Not
  recorded** until a person creates that record.
- A manager can generate flock work from the selected performance model and
  assign it to an active employee in the same province. Re-generating work
  updates the assignee only while work is still open; it never overwrites a
  completed record.
- Assigned employees see a focused Poultry page containing only their own work.
  They can start it, add an optional completion note and submit it. The API
  prevents them from reading another employee’s work or approving their own.
- A supervisor or manager can approve a completed task. The review API also
  supports returning work with a reason; every decision is retained in the
  review history.
- Open work past its work date is presented as **overdue** without destroying
  the original workflow status. The available states are planned, in progress,
  completed, skipped, missed and overdue.

```text
GET   /organizations/:orgSlug/poultry/daily-work/mine?date=YYYY-MM-DD
POST  /organizations/:orgSlug/poultry/flocks/:flockId/daily-work/generate
PATCH /organizations/:orgSlug/poultry/daily-work/:workItemId
POST  /organizations/:orgSlug/poultry/daily-work/:workItemId/review
```

Inventory deduction, new feed/water/no-record alerts, flock lifecycle stages,
and flock cost/revenue/profit are deliberately not part of this migration. They
are the next connected build so the implementation can use a real inventory
ledger and finance records instead of unreliable totals.

## Poultry setup management (implemented)

Migration `038_poultry_setup_management.sql` turns **Poultry → Setup** into the
company configuration area. It extends the existing Poultry tables and API;
it does not create a second house, flock or performance-standard concept.

### Owner/admin configuration

- Houses support site, company-local site code, capacity, compatible poultry
  type, operating status, dimensions, systems, description, notes and setup
  audit users. A house cannot be taken out of service, resized below its live
  flock or changed to an incompatible type while it has an operational flock.
- Starting a flock records the initial birds once, not as an employee daily
  entry. The API validates company/site/province scope, compatible active
  house, active-model compatibility and one operational flock per house. A
  capacity override needs a reason and is restricted to the company owner.
- Flocks retain supplier/hatchery, chick source, sex, age on arrival, costs,
  expected end date, model assignment and audit details. They move through
  planned, active, ready for sale/transfer, closed or cancelled (with legacy
  historical statuses retained). Closed history cannot be deleted.
- Closing records date, reason, notes, sold/transferred birds, final live
  count, final mortality and the user who closed it.
- Performance models support Broiler, Layer and Breeder standards. Weekly
  targets are company-editable: growth, feed/water, cumulative feed, FCR,
  gain, mortality/live-bird expectations, layer/breeder egg targets and
  temperature/humidity ranges. No target is hard-coded into daily records.
- A Setup form lets authorized users create/edit houses, start/edit/close
  flocks, create/edit models, add/edit/delete targets and assign a model to a
  flock. Each section has separate loading, empty and server-error states.
  Empty houses, flocks, models or targets are normal successful responses.

### Operational count and type rules

Expected live birds are calculated from:

```text
starting birds + arrivals - transfers out - culls - recorded mortality
```

A daily live-bird entry is a physical count. If it differs from the calculated
count, LiteHubs returns the discrepancy and flags it for supervisor review.
Performance uses the calculated expected population and displays physical count
as reconciliation data.

Egg collection is only offered by the field-entry screen for Layer or Breeder
flocks, and the API rejects egg records for any other flock type. The automatic
work generator applies the same rule. Inventory item IDs may now be linked to
feed, vaccination, treatment and sanitation records; no stock is deducted yet,
so the next inventory connection can use real item IDs rather than product-name
matching.

### Main routes

```text
GET/POST/PATCH /organizations/:orgSlug/poultry/houses
GET/POST/PATCH /organizations/:orgSlug/poultry/flocks
GET/POST/PATCH /organizations/:orgSlug/poultry/performance-models
GET/POST/PATCH/DELETE /organizations/:orgSlug/poultry/performance-models/:modelId/weekly-targets
GET           /organizations/:orgSlug/poultry/flocks/:flockId/performance
```

Existing `poultry.houses.*`, `poultry.flocks.*` and
`poultry.performance_models.*` permissions continue to enforce the actions in
these routes. The UI is permission-aware, but the API remains the security
boundary. Employee daily-record roles do not receive house, flock or model
configuration permissions.

### Current verification

- Migration state: 38 migrations applied.
- API and web TypeScript checks pass.
- A tenant-scoped Congo Omega read returned 1 house, 1 flock and 0 models
  successfully; an empty model list is therefore handled as an HTTP 200 data
  state, not a server failure.
- An existing Congo Omega flock performance read returned successfully with
  `model: null` and calculated live birds, proving that an unassigned model is
  a supported configuration state rather than a 500.

The full create scenario is intentionally left for an owner in the browser or
Postman so it does not add a fictional 500-bird flock to Congo Omega data.- A read-only provincial-supervisor check returned no houses or flocks when the
only existing house belonged to a different province, confirming that the
existing `member_provinces` boundary is applied to Poultry setup reads.

## Poultry frontend API coverage (implemented)

The workspace now has one typed frontend API layer at
`web/lib/poultry-api.ts`. It owns every Poultry URL and is used by the Poultry
dashboard, Setup, operational record desk and work planner. React Query keeps
server data and request state; the Zustand session store remains responsible
only for the current user and synchronous permission checks.

- **Overview, filterable list and performance reads** are connected to the
  Poultry overview, all 15 resource lists, flock performance, model targets,
  assigned work and My Work routes.
- **Production, health and field records** have a Records tab. Authorized
  staff can create, retrieve before editing, update and delete daily counts,
  feed, water, weights, eggs, mortality, health events, vaccinations,
  treatments, sanitation, biosecurity checks, flock targets and losses. The
  actual API continues to apply company, province, site and permission scope.
- **Setup** calls the shared API for houses, flocks, models, weekly targets and
  climate profiles. It also now includes editable climate adjustment profiles
  and vaccine schedules under a selected performance model.
- **Daily work** supports My Work, generated work, manual task creation,
  task updates and supervisor review from the workspace. The manual planner is
  for exceptional work; generated work remains tied to model requirements.

Closed flocks still cannot be deleted in the UI because their history is a
business record. The generic backend delete route deliberately preserves that
rule instead of providing a misleading delete action.

### Daily Work frontend API coverage

The workspace Daily Work area now calls every backend Daily Work route through `web/lib/daily-work-api.ts`. This includes the operational overview, checklist templates and their items (create, update and delete), daily runs and responses, completion and verification, reports (including editing a draft or submitted report), handovers and acknowledgement.

Checklist reads now include their scoped item configuration, so the owner or manager can open **Manage** from Daily Work to maintain the checklist and its questions without leaving the workspace. All normal requests continue to use the active organization URL and the existing backend permission and scope checks.

### Pig operations frontend API coverage

The Pigs workspace is now a complete API-backed operational area. `web/lib/pigs-api.ts` owns the organization-scoped routes for all 19 Pig resources: pens, groups, animals, daily counts, feed, water, weights, movements, mortality, losses, breeding, pregnancies, farrowing, piglets, health, vaccinations, treatments, quarantine and veterinary visits.

The Pigs page calls the overview and every permitted resource list automatically. Its record actions call the matching create, single-record view, update and delete endpoints. The screen follows the existing backend permission and province/site scope enforcement; frontend controls only appear when the current role has the corresponding Pig permission.
