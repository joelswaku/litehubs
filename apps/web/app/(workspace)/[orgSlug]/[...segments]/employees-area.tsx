"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Award,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChevronRight,
  CircleUserRound,
  ClipboardList,
  Edit3,
  FileText,
  MapPin,
  Mail,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HrPdfButton } from "@/components/hr/hr-pdf-button";
import { Field, Input, Textarea } from "@/components/ui/input";
import {
  EmptyState,
  ErrorState,
  NoAccessState,
  SkeletonCard,
} from "@/components/ui/states";
import { ApiError, get, orgUrl, patch, post } from "@/lib/api";
import {
  companySetupApi,
  type EmployeeCreationAllowance,
  type Invitation,
  type Member,
  type OrganizationRole,
  type Province,
} from "@/lib/company-setup-api";
import { can, isOwner } from "@/lib/permissions";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";

type Place = { id: string; code?: string | null; name: string };
type Site = {
  id: string;
  code: string;
  name: string;
  province: Place;
  isActive?: boolean;
};
type Department = {
  id: string;
  code: string;
  name: string;
  site?: Place | null;
  isActive?: boolean;
};
type Employee = {
  id: string;
  employeeNumber: string;
  fullName: string;
  jobTitle: string;
  positionCategory: "manager" | "supervisor" | "officer" | "employee";
  member?: {
    memberId: string;
    email?: string | null;
    fullName?: string | null;
  } | null;
  province?: Place | null;
  site?: Place | null;
  department?: Place | null;
  employment: {
    status: "active" | "probation" | "on_leave" | "suspended" | "terminated";
    type: "permanent" | "temporary" | "contract" | "casual" | "intern";
    startDate?: string | null;
  };
  contact: {
    phone?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
  };
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
};

type EmployeePerformance = {
  employee: { id: string; fullName: string; employeeNumber: string };
  score: number | null;
  level: "not_enough_data" | "excellent" | "good" | "medium" | "needs_improvement" | "critical";
  provisional: boolean;
  issues: string[];
  attendance: { scheduledDays: number; presentDays: number; lateDays: number; absentDays: number; unrecordedDays: number };
  dailyReports: { expected: number; submitted: number; missing: number };
  tasks: { assigned: number; completed: number; overdue: number };
};
type EmploymentContract = {
  id: string;
  reference: string;
  title: string;
  status: string;
  startsOn: string;
  endsOn: string | null;
  signedOn: string | null;
  document: { id: string; title: string | null } | null;
};
type Editor = { employee?: Employee } | null;
type EmployeeAccessDraft = {
  email: string;
  roleCode: string;
  provinceIds: string[];
};
type EmployeeFormSubmission = {
  body: Record<string, unknown>;
  access?: EmployeeAccessDraft;
};
type EmployeeSaveResult = {
  employee: Employee;
  emailDelivery?: { sent: boolean; reason?: string | null };
  accessError?: string;
};

const selectClass =
  "h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink focus:outline-2 focus:outline-ring";
const label = (fr: boolean, english: string, french: string) =>
  fr ? french : english;
const pretty = (value: string | null | undefined) =>
  String(value ?? "—")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
const dateValue = (value: string | null | undefined) =>
  value ? String(value).slice(0, 10) : "";
const optional = (data: FormData, key: string) =>
  String(data.get(key) ?? "").trim() || null;

function employeeError(error: unknown, field?: string) {
  if (!(error instanceof ApiError)) return undefined;
  return field ? error.fieldErrors[field]?.[0] : error.message;
}

/**
 * Employee records are HR records. They intentionally stay separate from a
 * LiteHubs login: a person may be employed without an account, while someone
 * who needs to sign in receives owner-assigned access that is linked here automatically.
 */
export function EmployeesArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const user = useSessionUser();
  const fr = locale === "fr";
  const canRead = can(user, "employees.read");
  const canCreate = can(user, "employees.create");
  const canUpdate = can(user, "employees.update");
  const client = useQueryClient();
  const [editor, setEditor] = useState<Editor>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [province, setProvince] = useState("all");
  const [site, setSite] = useState("all");
  const [accessInvite, setAccessInvite] = useState<Employee | null>(null);
  const [accessNotice, setAccessNotice] = useState<{
    tone: "good" | "warning";
    text: string;
  } | null>(null);

  const employees = useQuery({
    queryKey: ["employees", orgSlug],
    queryFn: () => get<{ employees: Employee[] }>(orgUrl(orgSlug, "employees")),
    enabled: canRead,
    select: (data) => data.employees,
  });
  const provinces = useQuery({
    queryKey: ["employee-provinces", orgSlug],
    queryFn: () =>
      companySetupApi.listProvinces<{ provinces: Province[] }>(orgSlug),
    enabled: canRead,
    select: (data) => data.provinces,
  });
  const sites = useQuery({
    queryKey: ["employee-sites", orgSlug],
    queryFn: () => companySetupApi.listSites<{ sites: Site[] }>(orgSlug),
    enabled: canRead,
    select: (data) => data.sites,
  });
  const departments = useQuery({
    queryKey: ["employee-departments", orgSlug],
    queryFn: () =>
      companySetupApi.listDepartments<{ departments: Department[] }>(orgSlug),
    enabled: canRead,
    select: (data) => data.departments,
  });
  const members = useQuery({
    queryKey: ["employee-members", orgSlug],
    queryFn: () => companySetupApi.listMembers<{ members: Member[] }>(orgSlug),
    enabled: (canCreate || canUpdate) && can(user, "members.read"),
    select: (data) => data.members,
  });
  const creationAllowances = useQuery({
    queryKey: ["employee-creation-allowances", orgSlug],
    queryFn: () =>
      companySetupApi.listEmployeeCreationAllowances<{
        allowances: EmployeeCreationAllowance[];
      }>(orgSlug),
    enabled: canRead && canCreate,
    select: (data) => data.allowances,
  });
  const invitationRoles = useQuery({
    queryKey: ["employee-invitation-roles", orgSlug],
    queryFn: () =>
      companySetupApi.listRoles<{ roles: OrganizationRole[] }>(orgSlug),
    enabled:
      isOwner(user) &&
      can(user, "invitations.create") &&
      can(user, "roles.read"),
    select: (data) => data.roles,
  });
  const canInviteAccess =
    isOwner(user) && can(user, "invitations.create") && can(user, "roles.read");
  const accessInvitations = useQuery({
    queryKey: ["employee-access-invitations", orgSlug],
    queryFn: () =>
      companySetupApi.listAccessAssignments<{ invitations: Invitation[] }>(
        orgSlug,
      ),
    enabled: isOwner(user) && can(user, "invitations.read"),
    select: (data) => data.invitations,
  });
  const availableCreationAllowances = (creationAllowances.data ?? []).filter(
    (allowance) => allowance.remainingEmployees > 0,
  );
  const canAddEmployees =
    canCreate && (isOwner(user) || availableCreationAllowances.length > 0);

  const save = useMutation({
    mutationFn: async ({
      id,
      body,
      access,
    }: {
      id?: string;
      body: Record<string, unknown>;
      access?: EmployeeAccessDraft;
    }): Promise<EmployeeSaveResult> => {
      const saved = id
        ? await patch<{ employee: Employee }>(
            orgUrl(orgSlug, `employees/${id}`),
            body,
          )
        : await post<{ employee: Employee }>(orgUrl(orgSlug, "employees"), body);

      // A saved employee must not be rolled back merely because SMTP is down.
      // The invitation service owns the account link and secure activation email.
      if (!access) return { employee: saved.employee };
      try {
        const assigned =
          await companySetupApi.assignAccess<AccessAssignmentResponse>(orgSlug, {
            email: access.email,
            roleCodes: [access.roleCode],
            provinceIds: access.provinceIds,
            jobTitle: saved.employee.jobTitle,
            employeeId: saved.employee.id,
          });
        return {
          employee: saved.employee,
          emailDelivery: assigned.emailDelivery,
        };
      } catch (error) {
        return {
          employee: saved.employee,
          accessError:
            error instanceof ApiError
              ? error.message
              : label(
                  fr,
                  "Employee created, but LiteHubs access could not be assigned.",
                  "L’employé a été créé, mais l’accès LiteHubs n’a pas pu être attribué.",
                ),
        };
      }
    },
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ["employees", orgSlug] });
      void client.invalidateQueries({ queryKey: ["org-members", orgSlug] });
      void client.invalidateQueries({ queryKey: ["org-invitations", orgSlug] });
      setSelectedId(result.employee.id);
      setEditor(null);
      if (result.accessError) {
        setAccessNotice({ tone: "warning", text: result.accessError });
      } else if (result.emailDelivery?.sent) {
        setAccessNotice({
          tone: "good",
          text: label(
            fr,
            "Employee created and secure LiteHubs access email sent.",
            "Employé créé et e-mail sécurisé d’accès LiteHubs envoyé.",
          ),
        });
      } else if (result.emailDelivery) {
        setAccessNotice({
          tone: "warning",
          text: label(
            fr,
            "Employee created and access assigned, but the e-mail was not sent. Check SMTP in development settings.",
            "Employé créé et accès attribué, mais l’e-mail n’a pas été envoyé. Vérifiez SMTP dans les paramètres de développement.",
          ),
        });
      }
    },
  });

  const rows = employees.data ?? [];
  const selected =
    rows.find((employee) => employee.id === selectedId) ?? rows[0] ?? null;
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return rows.filter((employee) => {
      const matchesSearch =
        !query ||
        [
          employee.employeeNumber,
          employee.fullName,
          employee.jobTitle,
          employee.department?.name,
          employee.site?.name,
          employee.province?.name,
          employee.member?.email,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase()
          .includes(query);
      return (
        matchesSearch &&
        (status === "all" || employee.employment.status === status) &&
        (province === "all" || employee.province?.id === province) &&
        (site === "all" || employee.site?.id === site)
      );
    });
  }, [province, rows, search, site, status]);

  if (!canRead)
    return <NoAccessState what={label(fr, "employees", "les employés")} />;
  if (employees.isPending)
    return (
      <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        <SkeletonCard rows={8} />
      </main>
    );
  if (employees.isError)
    return (
      <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        <ErrorState
          description={employeeError(employees.error)}
          onRetry={() => void employees.refetch()}
        />
      </main>
    );

  const active = rows.filter(
    (employee) => employee.employment.status === "active",
  ).length;
  const linked = rows.filter((employee) => employee.member?.memberId).length;
  const unassigned = rows.filter((employee) => !employee.site?.id).length;
  const pendingInvitationsByEmployeeId = new Map(
    (accessInvitations.data ?? [])
      .filter(
        (invitation) =>
          invitation.employeeId &&
          !invitation.acceptedAt &&
          !invitation.revokedAt &&
          new Date(invitation.expiresAt).getTime() >= Date.now(),
      )
      .map((invitation) => [invitation.employeeId!, invitation]),
  );
  const awaitingAccess = rows.filter((employee) =>
    pendingInvitationsByEmployeeId.has(employee.id),
  ).length;

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      {/* Same story as the profile aside: this stacked a hardcoded blue, a
          hardcoded teal and two near-whites, so it rendered only in light mode
          and `dark:bg-surface-1` discarded it wholesale in dark. One token
          gradient adapts to both. */}
      <header className="relative overflow-hidden rounded-3xl border border-border bg-surface-1 bg-linear-to-br from-brand/12 to-transparent px-5 py-7 text-ink shadow-md sm:px-7 sm:py-8">
        <div className="relative max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-brand">
            {label(fr, "People operations", "Gestion des équipes")}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            {label(fr, "Employees", "Employés")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-secondary">
            {label(
              fr,
              "Every employee has a five-digit number and a LiteHubs account for their personal schedule, tasks, attendance and permitted documents.",
              "Chaque employé a un numéro à cinq chiffres et un compte LiteHubs pour consulter son horaire, ses tâches, sa présence et ses documents autorisés.",
            )}
          </p>
        </div>
        {canAddEmployees ? (
          <Button
            className="relative mt-5 shadow-sm"
            onClick={() => setEditor({})}
          >
            <UserPlus />
            {label(fr, "Add employee", "Ajouter un employé")}
          </Button>
        ) : null}
      </header>
      {accessNotice ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            accessNotice.tone === "good"
              ? "border-good/30 bg-good/10 text-good-ink"
              : "border-warning/30 bg-warning/10 text-warning-ink"
          }`}
          role={accessNotice.tone === "good" ? "status" : "alert"}
        >
          <div className="flex items-start justify-between gap-3">
            <p>{accessNotice.text}</p>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setAccessNotice(null)}
              aria-label={label(fr, "Dismiss", "Fermer")}
            >
              <X />
            </Button>
          </div>
        </div>
      ) : null}
      {!isOwner(user) && canCreate ? (
        <section className="rounded-xl border border-brand/20 bg-brand/5 px-4 py-3 text-sm text-ink-secondary">
          <p className="font-medium text-ink">
            {fr
              ? "Autorisation de création d’employés"
              : "Employee-creation authorisation"}
          </p>
          {creationAllowances.isPending ? (
            <p className="mt-1 text-xs">
              {fr
                ? "Vérification de l’autorisation du propriétaire…"
                : "Checking the Owner’s authorisation…"}
            </p>
          ) : availableCreationAllowances.length ? (
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {availableCreationAllowances.map((entry) => (
                <Badge key={entry.id} variant="outline" icon={false}>
                  {entry.province.name} · {entry.remainingEmployees}{" "}
                  {fr ? "restant(s)" : "remaining"}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-xs">
              {fr
                ? "Le propriétaire n’a autorisé aucune fiche employé supplémentaire dans vos provinces."
                : "The Owner has not authorised any more employee profiles for your provinces."}
            </p>
          )}
        </section>
      ) : null}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric
          icon={Users}
          title={label(fr, "People on record", "Personnes enregistrées")}
          value={rows.length}
          text={label(fr, "Employee profiles", "Fiches employés")}
        />
        <Metric
          icon={BadgeCheck}
          title={label(fr, "Active", "Actifs")}
          value={active}
          text={label(fr, "Ready for work", "Prêts pour le travail")}
          tone="good"
        />
        <Metric
          icon={ShieldCheck}
          title={label(fr, "Linked accounts", "Comptes liés")}
          value={linked}
          text={label(fr, "Can use LiteHubs", "Peuvent utiliser LiteHubs")}
          tone="brand"
        />
        <Metric
          icon={Mail}
          title={label(fr, "Activation pending", "Activations en attente")}
          value={awaitingAccess}
          text={label(fr, "Invitation sent", "Invitation envoyée")}
          tone={awaitingAccess ? "warning" : "neutral"}
        />
        <Metric
          icon={MapPin}
          title={label(fr, "Location to confirm", "Lieu à confirmer")}
          value={unassigned}
          text={label(fr, "No site assigned", "Sans site affecté")}
          tone={unassigned ? "warning" : "neutral"}
        />
      </section>
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(19rem,.65fr)]">
        <section className="overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-sm">
          <div className="border-b border-border bg-linear-to-br from-brand/8 to-transparent p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-ink">
                  {label(fr, "Employee directory", "Répertoire des employés")}
                </h2>
                <p className="mt-1 text-xs leading-5 text-ink-secondary">
                  {label(
                    fr,
                    "Select a person to review their HR record or update their assignment.",
                    "Sélectionnez une personne pour consulter sa fiche RH ou modifier son affectation.",
                  )}
                </p>
              </div>
              <Badge variant="outline" icon={false}>
                {filtered.length} / {rows.length}
              </Badge>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_10rem_11rem_11rem]">
              <label className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
                <Input
                  className="pl-9"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={label(
                    fr,
                    "Search by name, number, job or location",
                    "Rechercher par nom, numéro, poste ou lieu",
                  )}
                />
              </label>
              <select
                className={selectClass}
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="all">
                  {label(fr, "All statuses", "Tous les statuts")}
                </option>
                {[
                  "active",
                  "probation",
                  "on_leave",
                  "suspended",
                  "terminated",
                ].map((value) => (
                  <option key={value} value={value}>
                    {pretty(value)}
                  </option>
                ))}
              </select>
              <select
                className={selectClass}
                value={province}
                onChange={(event) => {
                  setProvince(event.target.value);
                  setSite("all");
                }}
              >
                <option value="all">
                  {label(fr, "All provinces", "Toutes les provinces")}
                </option>
                {(provinces.data ?? uniqueProvinces(rows))
                  .filter((entry) => entry.name)
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
              </select>
              <select
                className={selectClass}
                value={site}
                onChange={(event) => setSite(event.target.value)}
              >
                <option value="all">
                  {label(fr, "All sites", "Tous les sites")}
                </option>
                {(sites.data ?? uniqueSites(rows))
                  .filter(
                    (entry) =>
                      entry.name &&
                      (province === "all" || entry.province.id === province),
                  )
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          {!filtered.length ? (
            <EmptyState
              title={label(
                fr,
                "No employee matches this view",
                "Aucun employé ne correspond à cette vue",
              )}
              description={
                rows.length
                  ? label(
                      fr,
                      "Change the filters or search terms.",
                      "Modifiez les filtres ou les termes de recherche.",
                    )
                  : label(
                      fr,
                      "Create the first employee profile to begin assigning work and attendance.",
                      "Créez la première fiche employé pour commencer les affectations et la présence.",
                    )
              }
              icon={Users}
            />
          ) : (
            <div className="grid gap-3 bg-linear-to-br from-brand/5 to-transparent p-3">
              {filtered.map((employee) => (
                <button
                  key={employee.id}
                  type="button"
                  onClick={() => setSelectedId(employee.id)}
                  className={`group flex w-full flex-wrap items-center gap-3 rounded-xl border bg-surface-1 px-4 py-4 text-left shadow-sm transition-all duration-200 sm:px-5 ${selected?.id === employee.id ? "border-brand/50 bg-brand/5 shadow-md shadow-brand/10" : "border-border hover:-translate-y-px hover:border-brand/30 hover:shadow-md"}`}
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-brand/15 bg-brand/10 text-sm font-bold text-brand">
                    {employee.employeeNumber.slice(-2)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-ink">
                        {employee.fullName}
                      </span>
                      <Badge
                        variant={statusVariant(employee.employment.status)}
                      >
                        {pretty(employee.employment.status)}
                      </Badge>
                      {employee.member?.memberId ? (
                        <Badge variant="good" icon={false}>
                          {label(fr, "Compte actif", "Active account")}
                        </Badge>
                      ) : pendingInvitationsByEmployeeId.has(employee.id) ? (
                        <Badge variant="warning" icon={false}>
                          {label(fr, "Invitation envoyée", "Invitation sent")}
                        </Badge>
                      ) : (
                        <Badge variant="serious" icon={false}>
                          {label(fr, "Accès à créer", "Access to create")}
                        </Badge>
                      )}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-ink-secondary">
                      <span className="font-medium text-brand">
                        #{employee.employeeNumber}
                      </span>
                      <span>{employee.jobTitle}</span>
                      {employee.site?.name ? (
                        <span>· {employee.site.name}</span>
                      ) : null}
                      {employee.department?.name ? (
                        <span>· {employee.department.name}</span>
                      ) : null}
                    </span>
                  </span>
                  <ChevronRight className="size-4 text-ink-muted transition-colors group-hover:text-brand" />
                </button>
              ))}
            </div>
          )}
        </section>

        <EmployeeProfile
          employee={selected}
          orgSlug={orgSlug}
          fr={fr}
          canUpdate={canUpdate}
          canPerformance={can(user, "performance.read")}
          canContracts={can(user, "contracts.read")}
          onEdit={() => selected && setEditor({ employee: selected })}
          canInviteAccess={canInviteAccess}
          invitation={
            selected ? pendingInvitationsByEmployeeId.get(selected.id) ?? null : null
          }
          onInvite={() => selected && setAccessInvite(selected)}
        />
      </section>
      <section className="rounded-2xl border border-border bg-surface-1 p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
            <CircleUserRound className="size-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-ink">
              {label(
                fr,
                "Employee profile and LiteHubs access are separate",
                "La fiche employé et l’accès LiteHubs sont séparés",
              )}
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-secondary">
              {label(
                fr,
                "Every employee needs a LiteHubs account. Creation sends a secure invitation and the employee chooses their password. The employee number identifies the worker; roles control permissions and the dashboard.",
                "Chaque employé a besoin d’un compte LiteHubs. La création envoie une invitation sécurisée et l’employé choisit son mot de passe. Le numéro d’employé identifie le travailleur ; les rôles contrôlent les permissions et le tableau de bord.",
              )}
            </p>
          </div>
        </div>
      </section>
      {editor ? (
        <EmployeeDialog
          employee={editor.employee}
          orgSlug={orgSlug}
          fr={fr}
          provinces={provinces.data ?? []}
          sites={sites.data ?? []}
          departments={departments.data ?? []}
          members={members.data ?? []}
          linkedMemberIds={rows.flatMap((entry) =>
            entry.member?.memberId ? [entry.member.memberId] : [],
          )}
          membersAvailable={can(user, "members.read")}
          canInviteAccess={canInviteAccess}
          canManageLoginEmail={isOwner(user)}
          accessRoles={invitationRoles.data ?? []}
          creationProvinceIds={
            isOwner(user)
              ? undefined
              : availableCreationAllowances.map((entry) => entry.province.id)
          }
          busy={save.isPending}
          error={save.error}
          onClose={() => setEditor(null)}
          onSubmit={(submission) =>
            save.mutate({
              id: editor.employee?.id,
              body: submission.body,
              access: submission.access,
            })
          }
        />
      ) : null}
      {accessInvite ? (
        <AccessAssignmentDialog
          key={accessInvite.id}
          employee={accessInvite}
          orgSlug={orgSlug}
          fr={fr}
          roles={invitationRoles.data ?? []}
          provinces={provinces.data ?? []}
          onClose={() => setAccessInvite(null)}
        />
      ) : null}{" "}
    </main>
  );
}

type AccessAssignmentResponse = {
  invitation: { invitationId: string; email: string };
  emailDelivery?: { sent: boolean; reason?: string | null };
};

/** The recipient activates owner-assigned access through
 * the one-time email link; passwords are never sent by email. */
function AccessAssignmentDialog({
  employee,
  orgSlug,
  fr,
  roles,
  provinces,
  onClose,
}: {
  employee: Employee;
  orgSlug: string;
  fr: boolean;
  roles: OrganizationRole[];
  provinces: Province[];
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [provinceIds, setProvinceIds] = useState<string[]>(
    employee.province?.id ? [employee.province.id] : [],
  );
  const [result, setResult] = useState<"sent" | "not_sent" | null>(null);
  const allowedRoles = roles.filter((role) => role.code !== "owner");
  const invite = useMutation({
    mutationFn: (body: {
      email: string;
      roleCodes: string[];
      provinceIds: string[];
      jobTitle: string;
      employeeId: string;
    }) => companySetupApi.assignAccess<AccessAssignmentResponse>(orgSlug, body),
    onSuccess: (response) => {
      setResult(response.emailDelivery?.sent ? "sent" : "not_sent");
      void client.invalidateQueries({ queryKey: ["org-invitations", orgSlug] });
      void client.invalidateQueries({ queryKey: ["employees", orgSlug] });
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    invite.mutate({
      email: String(data.get("email") ?? "")
        .trim()
        .toLowerCase(),
      roleCodes: [String(data.get("roleCode") ?? "")].filter(Boolean),
      provinceIds,
      jobTitle: employee.jobTitle,
      employeeId: employee.id,
    });
  };
  const toggleProvince = (id: string) =>
    setProvinceIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  const error = employeeError(invite.error);

  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto bg-ink/45 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={label(
        fr,
        "Assign LiteHubs access",
        "Affecter un accès LiteHubs",
      )}
    >
      <section className="mx-auto my-10 w-full max-w-xl rounded-2xl border border-border bg-surface-1 p-5 shadow-xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-brand">
              {label(fr, "Secure sign-in", "Connexion sécurisée")}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-ink">
              {label(
                fr,
                "Assign LiteHubs access",
                "Affecter un accès LiteHubs",
              )}
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">
              {label(
                fr,
                `Assign LiteHubs access to ${employee.fullName}. They choose their own password from the secure email; LiteHubs never sends passwords by email.`,
                `Affectez l’accès LiteHubs à ${employee.fullName}. La personne définit son propre mot de passe depuis l’e-mail sécurisé ; LiteHubs n’envoie jamais de mot de passe par e-mail.`,
              )}
            </p>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onClose}
            aria-label={label(fr, "Close", "Fermer")}
          >
            <X />
          </Button>
        </div>
        {result === "sent" ? (
          <div
            className="mt-5 rounded-xl border border-good/30 bg-good/10 p-3 text-sm text-good-ink"
            role="status"
          >
            {label(
              fr,
              "The access email was sent. Once activated, LiteHubs automatically links the new account to this employee profile.",
              "L’e-mail d’accès a été envoyé. Une fois l’accès activé, LiteHubs lie automatiquement le nouveau compte à cette fiche employé.",
            )}
          </div>
        ) : null}
        {result === "not_sent" ? (
          <div
            className="mt-5 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning-ink"
            role="alert"
          >
            {label(
              fr,
              "The access assignment was created, but its email was not sent. Check SMTP before assigning another address.",
              "L’affectation d’accès a été créée, mais l’e-mail n’a pas été envoyé. Vérifiez SMTP avant d’affecter une autre adresse.",
            )}
          </div>
        ) : null}
        {!result ? (
          <form className="mt-5 space-y-4" onSubmit={submit}>
            <Field
              label={label(fr, "Work email", "E-mail professionnel")}
              htmlFor="employee-access-email"
              required
              error={employeeError(invite.error, "email")}
            >
              <Input
                id="employee-access-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                autoFocus
                invalid={Boolean(employeeError(invite.error, "email"))}
              />
            </Field>
            <Field
              label={label(fr, "LiteHubs role", "Rôle LiteHubs")}
              htmlFor="employee-access-role"
              required
              hint={label(
                fr,
                "The selected role controls permissions after sign-in.",
                "Le rôle choisi contrôle les permissions après la connexion.",
              )}
            >
              <select
                id="employee-access-role"
                name="roleCode"
                className={selectClass}
                defaultValue=""
                required
                disabled={!allowedRoles.length}
              >
                <option value="">
                  {label(fr, "Select a role", "Sélectionnez un rôle")}
                </option>
                {allowedRoles.map((role) => (
                  <option key={role.id} value={role.code}>
                    {role.name}
                  </option>
                ))}
              </select>
            </Field>
            <fieldset>
              <legend className="text-xs font-medium text-ink-secondary">
                {label(fr, "Province access", "Accès aux provinces")}
              </legend>
              <p className="mt-1 text-xs leading-5 text-ink-muted">
                {label(
                  fr,
                  "The employee’s province is preselected. Add the provinces this person is allowed to see.",
                  "La province de l’employé est présélectionnée. Ajoutez les provinces que cette personne peut consulter.",
                )}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                {provinces
                  .filter((province) => province.isActive !== false)
                  .map((province) => (
                    <label
                      key={province.id}
                      className="flex items-center gap-2 text-sm text-ink"
                    >
                      <input
                        type="checkbox"
                        checked={provinceIds.includes(province.id)}
                        onChange={() => toggleProvince(province.id)}
                        className="size-4 accent-[var(--brand)]"
                      />
                      {province.name}
                    </label>
                  ))}
              </div>
            </fieldset>
            {error ? (
              <p className="text-sm text-critical" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
              <Button type="button" variant="secondary" onClick={onClose}>
                {label(fr, "Cancel", "Annuler")}
              </Button>
              <Button
                type="submit"
                loading={invite.isPending}
                disabled={!allowedRoles.length}
              >
                <Mail />
                {label(
                  fr,
                  "Assign and send access",
                  "Affecter et envoyer l’accès",
                )}
              </Button>
            </div>
          </form>
        ) : (
          <div className="mt-5 flex justify-end">
            <Button onClick={onClose}>{label(fr, "Done", "Terminé")}</Button>
          </div>
        )}
      </section>
    </div>
  );
}
function Metric({
  icon: Icon,
  title,
  value,
  text,
  tone = "neutral",
}: {
  icon: typeof Users;
  title: string;
  value: number;
  text: string;
  tone?: "neutral" | "good" | "brand" | "warning";
}) {
  const colors = {
    neutral: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
    good: "bg-good/10 text-good-ink",
    brand: "bg-brand/10 text-brand",
    warning: "bg-warning/15 text-warning-ink",
  };
  const surface = {
    neutral: "border-slate-300/80 from-slate-500/8 via-transparent to-transparent",
    good: "border-good/30 from-good/12 via-transparent to-transparent",
    brand: "border-brand/30 from-brand/12 via-transparent to-transparent",
    warning: "border-warning/35 from-warning/15 via-transparent to-transparent",
  };
  return (
    <article className={`group relative overflow-hidden rounded-2xl border bg-gradient-to-br p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${surface[tone]}`}>
      <span className="absolute right-4 top-4 size-9 rounded-full border border-current/10 bg-current/[.035]" aria-hidden />
      <div className="relative">
        <div className={`grid size-10 place-items-center rounded-xl border border-current/10 ${colors[tone]}`}>
          <Icon className="size-4" />
        </div>
        <p className="mt-4 text-xs font-semibold text-ink-secondary">{title}</p>
        <p className="mt-1 text-2xl font-semibold tracking-[-.03em] text-ink">
          {value}
        </p>
        <p className="mt-2 border-t border-border pt-2 text-xs text-ink-muted">{text}</p>
      </div>
    </article>
  );
}
function EmployeeProfile({
  employee,
  orgSlug,
  fr,
  canUpdate,
  canPerformance,
  canContracts,
  canInviteAccess,
  invitation,
  onInvite,
  onEdit,
}: {
  employee: Employee | null;
  orgSlug: string;
  fr: boolean;
  canUpdate: boolean;
  canPerformance: boolean;
  canContracts: boolean;
  canInviteAccess: boolean;
  invitation: Invitation | null;
  onInvite: () => void;
  onEdit: () => void;
}) {
  const automaticPerformance = useQuery({
    queryKey: ["employee-automatic-performance", orgSlug, employee?.id],
    queryFn: () => get<{ employees: EmployeePerformance[] }>(orgUrl(orgSlug, `performance-analytics?employeeId=${employee!.id}`)).then((data) => data.employees[0] ?? null),
    enabled: Boolean(employee) && canPerformance,
  });
  const employmentContracts = useQuery({
    queryKey: ["employee-employment-contracts", orgSlug, employee?.id],
    queryFn: () =>
      get<{ contracts: EmploymentContract[] }>(
        orgUrl(
          orgSlug,
          `contracts?contractType=employment&employeeId=${employee!.id}`,
        ),
      ).then((data) => data.contracts),
    enabled: Boolean(employee) && canContracts,
  });
  if (!employee)
    return (
      <section className="rounded-2xl border border-border bg-surface-1 p-5 shadow-sm">
        <EmptyState
          title={label(fr, "No employee selected", "Aucun employé sélectionné")}
          description={label(
            fr,
            "Select a person from the directory to see their details.",
            "Sélectionnez une personne dans le répertoire pour consulter ses détails.",
          )}
          icon={CircleUserRound}
        />
      </section>
    );
  const pair = (icon: ReactNode, name: string, value?: string | null) => (
    <div className="flex gap-2 rounded-xl border border-border bg-surface-2 p-3 text-sm transition-colors hover:border-brand/20">
      <span className="mt-0.5 text-ink-muted">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-ink-muted">{name}</p>
        <p className="mt-0.5 break-words font-medium text-ink">
          {value || "—"}
        </p>
      </div>
    </div>
  );
  return (
    <aside className="h-fit overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-sm">
      {/* One brand-derived wash instead of three stacked gradients. The old
          stack hardcoded a blue, a teal and two near-whites, so it only worked
          in light mode -- which is why it carried a `dark:bg-surface-1` that
          threw the whole effect away in dark rather than adapting it. A token
          gradient renders in both themes and needs no override. */}
      <div className="relative border-b border-border bg-linear-to-br from-brand/12 to-transparent p-5 text-ink">
        <div className="flex items-start justify-between gap-3">
          <span className="grid size-12 place-items-center rounded-2xl border border-brand/15 bg-brand text-lg font-semibold text-brand-ink shadow-sm">
            {employee.fullName
              .split(/\s+/)
              .slice(0, 2)
              .map((word) => word[0])
              .join("")
              .toUpperCase()}
          </span>
          <Badge
            variant={statusVariant(employee.employment.status)}
            className="shadow-sm"
          >
            {pretty(employee.employment.status)}
          </Badge>
        </div>
        <h2 className="mt-4 text-xl font-semibold tracking-tight">
          {employee.fullName}
        </h2>
        <p className="mt-1 text-sm text-brand">{employee.jobTitle}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold tracking-wide text-brand">
            #{employee.employeeNumber}
          </p>
          <Badge
            variant={
              employee.member?.memberId
                ? "good"
                : invitation
                  ? "info"
                  : "outline"
            }
          >
            {employee.member?.memberId
              ? label(fr, "LiteHubs access active", "Accès LiteHubs actif")
              : invitation
                ? label(fr, "Activation pending", "Activation en attente")
                : label(fr, "Access to create", "Accès à créer")}
          </Badge>
        </div>
      </div>
      <div className="space-y-4 p-5">
        {pair(
          <BriefcaseBusiness className="size-4" />,
          label(fr, "Employment", "Emploi"),
          `${pretty(employee.positionCategory)} · ${pretty(employee.employment.type)}`,
        )}
        {pair(
          <MapPin className="size-4" />,
          label(fr, "Assignment", "Affectation"),
          [
            employee.province?.name,
            employee.site?.name,
            employee.department?.name,
          ]
            .filter(Boolean)
            .join(" · ") || null,
        )}
        {pair(
          <CalendarDays className="size-4" />,
          label(fr, "Start date", "Date de début"),
          employee.employment.startDate
            ? new Intl.DateTimeFormat(fr ? "fr-FR" : "en", {
                dateStyle: "medium",
              }).format(new Date(employee.employment.startDate))
            : null,
        )}
        {pair(
          <Phone className="size-4" />,
          label(fr, "Contact", "Contact"),
          employee.contact.phone,
        )}
        {pair(
          <UserCheck className="size-4" />,
          label(fr, "Emergency contact", "Contact d’urgence"),
          [employee.contact.emergencyContactName, employee.contact.emergencyContactPhone]
            .filter(Boolean)
            .join(" · ") || null,
        )}
        {pair(
          <UserCheck className="size-4" />,
          label(fr, "LiteHubs account", "Compte LiteHubs"),
          employee.member?.email ??
            (invitation
              ? label(
                  fr,
                  `Invitation sent to ${invitation.email} — awaiting activation`,
                  `Invitation envoyée à ${invitation.email} — en attente d’activation`,
                )
              : label(
                  fr,
                  "Access to create — no sign-in account yet",
                  "Accès à créer — aucun compte de connexion pour le moment",
                )),
        )}
        {canContracts ? (
          <section className="overflow-hidden rounded-xl border border-brand/20 bg-brand/5">
            <div className="flex items-start justify-between gap-3 border-b border-brand/15 px-3 py-3">
              <div className="flex min-w-0 gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-brand/20 bg-surface-1 text-brand">
                  <FileText className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    {label(fr, "Employment contracts", "Contrats de travail")}
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-ink-secondary">
                    {label(
                      fr,
                      "Employment contracts linked to this HR record.",
                      "Contrats de travail liés à cette fiche RH.",
                    )}
                  </p>
                </div>
              </div>
              <a
                href={`/${orgSlug}/contracts`}
                className="shrink-0 text-xs font-semibold text-brand underline-offset-4 hover:underline"
              >
                {label(fr, "Open register", "Ouvrir le registre")}
              </a>
            </div>
            <div className="space-y-2 p-3">
              {employmentContracts.isPending ? (
                <p className="text-sm text-ink-secondary">
                  {label(fr, "Loading contracts…", "Chargement des contrats…")}
                </p>
              ) : employmentContracts.isError ? (
                <p className="text-sm text-warning-ink">
                  {label(
                    fr,
                    "The contracts could not be loaded. Open the register to retry.",
                    "Les contrats n’ont pas pu être chargés. Ouvrez le registre pour réessayer.",
                  )}
                </p>
              ) : employmentContracts.data?.length ? (
                employmentContracts.data.map((contract) => (
                  <article
                    key={contract.id}
                    className="rounded-lg border border-border bg-surface-1 px-3 py-2.5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">
                          {contract.title}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-secondary">
                          {contract.reference} · {label(fr, "Starts", "Début")}{" "}
                          {new Intl.DateTimeFormat(fr ? "fr-FR" : "en", {
                            dateStyle: "medium",
                          }).format(new Date(`${contract.startsOn}T12:00:00`))}
                        </p>
                      </div>
                      <Badge
                        variant={
                          ["active", "signed"].includes(contract.status)
                            ? "good"
                            : ["rejected", "terminated", "cancelled"].includes(
                                  contract.status,
                                )
                              ? "serious"
                              : "warning"
                        }
                      >
                        {pretty(contract.status)}
                      </Badge>
                    </div>
                  </article>
                ))
              ) : (
                <p className="text-sm leading-6 text-ink-secondary">
                  {label(
                    fr,
                    "No employment contract is linked to this employee yet.",
                    "Aucun contrat de travail n’est encore lié à cet employé.",
                  )}
                </p>
              )}
            </div>
          </section>
        ) : null}
        {canPerformance ? <div className="rounded-xl border border-brand/20 bg-brand/5 p-3"><div className="flex items-start gap-2"><Award className="mt-0.5 size-4 text-brand" /><div className="min-w-0 flex-1"><p className="text-xs text-ink-muted">{label(fr, "Automatic performance", "Performance automatique")}</p>{automaticPerformance.isPending ? <p className="mt-1 text-sm text-ink-secondary">{label(fr, "Calculating from attendance, reports and tasks…", "Calcul depuis présence, rapports et tâches…")}</p> : automaticPerformance.data ? <><div className="mt-1 flex flex-wrap items-center gap-2"><p className="text-lg font-semibold text-ink">{automaticPerformance.data.score === null ? "—" : `${Math.round(automaticPerformance.data.score)}%`}</p><Badge variant={automaticPerformance.data.level === "excellent" || automaticPerformance.data.level === "good" ? "good" : automaticPerformance.data.level === "medium" ? "info" : automaticPerformance.data.level === "not_enough_data" ? "outline" : "warning"}>{({ excellent: label(fr,"Excellent","Excellent"), good: label(fr,"Good","Bon"), medium: label(fr,"Average","Moyen"), needs_improvement: label(fr,"Needs improvement","À améliorer"), critical: label(fr,"Critical","Critique"), not_enough_data: label(fr,"Data needed","Données insuffisantes") })[automaticPerformance.data.level]}</Badge></div><p className="mt-1 text-xs text-ink-secondary">{automaticPerformance.data.attendance.presentDays + automaticPerformance.data.attendance.lateDays}/{automaticPerformance.data.attendance.scheduledDays} {label(fr,"days recorded","jours enregistrés")} · {automaticPerformance.data.dailyReports.submitted}/{automaticPerformance.data.dailyReports.expected} {label(fr,"reports","rapports")}</p>{automaticPerformance.data.issues.length ? <p className="mt-1 text-xs font-medium text-warning-ink">{label(fr,"Follow-up needed","Suivi nécessaire")}</p> : null}</> : <p className="mt-1 text-xs text-ink-secondary">{label(fr,"No operational record yet.","Aucune donnée opérationnelle pour le moment.")}</p>}</div></div></div> : null}
        {employee.notes ? (
          <div className="rounded-xl border border-border bg-surface-2 p-3">
            <p className="text-xs font-medium text-ink-muted">
              {label(fr, "Notes", "Notes")}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink-secondary">
              {employee.notes}
            </p>
          </div>
        ) : null}
        {!employee.member?.memberId && !invitation && canInviteAccess ? (
          <Button className="w-full justify-between" variant="outline" onClick={onInvite}>
            <Mail />
            {label(fr, "Assign LiteHubs access", "Affecter un accès LiteHubs")}
          </Button>
        ) : null}
        <HrPdfButton orgSlug={orgSlug} report="employee" employeeId={employee.id} fr={fr} className="w-full justify-between border-border bg-surface-2 text-ink hover:border-brand/40 hover:bg-brand/5 hover:text-brand" />
        {canUpdate ? (
          <Button className="w-full justify-between" variant="secondary" onClick={onEdit}>
            <Edit3 />
            {label(fr, "Edit employee", "Modifier l’employé")}
          </Button>
        ) : null}
      </div>
    </aside>
  );
}

function EmployeeDialog({
  employee,
  orgSlug,
  fr,
  provinces,
  sites,
  departments,
  members,
  linkedMemberIds,
  membersAvailable,
  canInviteAccess,
  canManageLoginEmail,
  accessRoles,
  creationProvinceIds,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  employee?: Employee;
  orgSlug: string;
  fr: boolean;
  provinces: Province[];
  sites: Site[];
  departments: Department[];
  members: Member[];
  linkedMemberIds: string[];
  membersAvailable: boolean; /** Undefined means Owner; an empty list means the delegation is exhausted. */
  canInviteAccess: boolean;
  canManageLoginEmail: boolean;
  accessRoles: OrganizationRole[];
  creationProvinceIds?: string[];
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (submission: EmployeeFormSubmission) => void;
}) {
  const restrictedCreation = !employee && creationProvinceIds !== undefined;
  const [selectedProvince, setSelectedProvince] = useState(
    employee?.province?.id ??
      (restrictedCreation && creationProvinceIds?.length === 1
        ? creationProvinceIds[0]
        : ""),
  );
  const [selectedSite, setSelectedSite] = useState(employee?.site?.id ?? "");
  const [accessEmail, setAccessEmail] = useState("");
  const [accessProvinceIds, setAccessProvinceIds] = useState<string[]>([]);
  const accessRolesForInvite = accessRoles.filter((role) => role.code !== "owner");
  const hasAccessEmail = accessEmail.trim().length > 0;
  const selectableProvinces = provinces.filter(
    (province) =>
      province.isActive !== false &&
      (!restrictedCreation || creationProvinceIds?.includes(province.id)),
  );
  const filteredSites = sites.filter(
    (entry) =>
      entry.isActive !== false &&
      (!selectedProvince || entry.province.id === selectedProvince),
  );
  const filteredDepartments = departments.filter(
    (entry) =>
      entry.isActive !== false &&
      (!selectedSite || !entry.site?.id || entry.site.id === selectedSite),
  );
  const errorMessage = employeeError(error);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {
      fullName: String(form.get("fullName") ?? "").trim(),
      jobTitle: String(form.get("jobTitle") ?? "").trim(),
      employmentStatus: String(form.get("employmentStatus") ?? "active"),
      employmentType: String(form.get("employmentType") ?? "permanent"),
    };
    // Create accepts omitted optional values; edit accepts null to intentionally
    // clear a stored value. Sending an empty string or null during creation
    // would fail the API's UUID/date validation.
    for (const key of [
      "memberId",
      "provinceId",
      "siteId",
      "departmentId",
      "startDate",
      "phone",
      "emergencyContactName",
      "emergencyContactPhone",
      "notes",
    ]) {
      const value = optional(form, key);
      if (value) body[key] = value;
      else if (employee) body[key] = null;
    }
    const email = String(form.get("accessEmail") ?? "")
      .trim()
      .toLowerCase();
    const selectedMemberId = String(form.get("memberId") ?? "").trim();
    if (employee?.member?.memberId && canManageLoginEmail) {
      const loginEmail = String(form.get("loginEmail") ?? "").trim().toLowerCase();
      if (loginEmail && loginEmail !== employee.member.email?.toLowerCase()) {
        body.loginEmail = loginEmail;
      }
    }
    const assignAccess =
      canInviteAccess &&
      Boolean(email) &&
      !selectedMemberId &&
      (!employee || !employee.member?.memberId);
    const roleCode =
      String(form.get("accessRoleCode") ?? "").trim() || "employee";
    onSubmit({
      body,
      access: assignAccess
        ? {
            email,
            roleCode,
            provinceIds:
              accessProvinceIds.length > 0
                ? accessProvinceIds
                : selectedProvince
                  ? [selectedProvince]
                  : [],
          }
        : undefined,
    });
  };
  const field = (name: string) => employeeError(error, name);
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-ink/45 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={
        employee
          ? label(fr, "Edit employee", "Modifier l’employé")
          : label(fr, "Add employee", "Ajouter un employé")
      }
    >
      <section className="mx-auto my-5 w-full max-w-4xl rounded-2xl border border-border bg-surface-1 p-5 shadow-xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-brand">
              {label(fr, "Human resources", "Ressources humaines")}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-ink">
              {employee
                ? label(fr, "Edit employee", "Modifier l’employé")
                : label(fr, "Add employee", "Ajouter un employé")}
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-secondary">
              {label(
                fr,
                "The employee number is assigned automatically after saving. Permissions come from the linked LiteHubs account and its role, not from this number.",
                "Le numéro d’employé est attribué automatiquement après l’enregistrement. Les permissions proviennent du compte LiteHubs lié et de son rôle, pas de ce numéro.",
              )}
            </p>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onClose}
            aria-label={label(fr, "Close", "Fermer")}
          >
            <X />
          </Button>
        </div>
        {errorMessage ? (
          <p
            className="mt-4 rounded-lg border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical"
            role="alert"
          >
            {errorMessage}
          </p>
        ) : null}
        <form className="mt-5 space-y-5" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field
              label={label(fr, "Full name", "Nom complet")}
              htmlFor="employee-full-name"
              required
              error={field("fullName")}
            >
              <Input
                name="fullName"
                defaultValue={employee?.fullName ?? ""}
                invalid={Boolean(field("fullName"))}
              />
            </Field>
            <Field
              label={label(fr, "Job title", "Poste")}
              htmlFor="employee-job-title"
              required
              error={field("jobTitle")}
            >
              <Input
                name="jobTitle"
                defaultValue={employee?.jobTitle ?? ""}
                invalid={Boolean(field("jobTitle"))}
              />
            </Field>
            <Field
              label={label(
                fr,
                "Role-derived level",
                "Niveau calculé par le rôle",
              )}
              htmlFor="employee-position-category"
              hint={label(
                fr,
                "This field updates automatically when the linked person role changes in Team and access.",
                "Ce niveau est actualisé automatiquement lorsque le rôle LiteHubs de la personne liée change dans Équipe et accès.",
              )}
            >
              <Input
                value={
                  employee
                    ? pretty(employee.positionCategory)
                    : label(
                        fr,
                        "Employee until a LiteHubs role is assigned",
                        "Employé jusqu’à l’attribution d’un rôle LiteHubs",
                      )
                }
                disabled
                readOnly
              />
            </Field>
          </div>
          {employee ? (
          <div className="rounded-xl border border-border bg-surface-2 p-4">
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 size-4 text-brand" />
              <div>
                <h3 className="text-sm font-semibold text-ink">
                  {label(
                    fr,
                    "LiteHubs account (optional)",
                    "Compte LiteHubs (facultatif)",
                  )}
                </h3>
                <p className="mt-1 text-xs leading-5 text-ink-secondary">
                  {label(
                    fr,
                    "For older employee profiles only: link a person who already has LiteHubs access. Do not use this to assign permissions; use Team and access for the person’s role and province scope.",
                    "Uniquement pour les anciennes fiches employé : liez une personne qui possède déjà un accès LiteHubs. N’utilisez pas ce choix pour attribuer des permissions : utilisez Équipe et accès pour le rôle et la portée provinciale.",
                  )}
                </p>
              </div>
            </div>
            {employee.member?.email ? (
              <div className="mt-4 rounded-lg border border-brand/20 bg-brand/5 p-3">
                <Field
                  label={label(fr, "LiteHubs sign-in email", "E-mail de connexion LiteHubs")}
                  htmlFor="employee-linked-access-email"
                  error={field("loginEmail")}
                  hint={
                    canManageLoginEmail
                      ? label(
                          fr,
                          "Owner-only security setting. Saving a new address signs the employee out of active devices; they use the new address at next sign-in.",
                          "Paramètre de sécurité réservé au propriétaire. Après modification, l’employé est déconnecté de ses appareils et se reconnecte avec la nouvelle adresse.",
                        )
                      : label(
                          fr,
                          "This login address is managed only by the Owner for security. Roles and access scope are managed in Team and access.",
                          "Cette adresse de connexion est gérée uniquement par le propriétaire pour des raisons de sécurité. Le rôle et le périmètre se gèrent dans Équipe et accès.",
                        )
                  }
                >
                  <Input
                    id="employee-linked-access-email"
                    name="loginEmail"
                    type="email"
                    defaultValue={employee.member.email}
                    readOnly={!canManageLoginEmail}
                    disabled={!canManageLoginEmail}
                    invalid={Boolean(field("loginEmail"))}
                  />
                </Field>
              </div>
            ) : null}
            <div className="mt-3">
              <select
                name="memberId"
                defaultValue={employee?.member?.memberId ?? ""}
                className={selectClass}
                disabled={!membersAvailable}
              >
                <option value="">
                  {membersAvailable
                    ? label(
                        fr,
                        "No LiteHubs account linked",
                        "Aucun compte LiteHubs lié",
                      )
                    : label(
                        fr,
                        "You cannot view team accounts",
                        "Vous ne pouvez pas consulter les comptes de l’équipe",
                      )}
                </option>
                {members
                  .filter(
                    (member) =>
                      member.status === "active" &&
                      (member.memberId === employee?.member?.memberId ||
                        !linkedMemberIds.includes(member.memberId)),
                  )
                  .map((member) => (
                    <option key={member.memberId} value={member.memberId}>
                      {member.fullName} · {member.email}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          ) : null}
          {canInviteAccess && (!employee || !employee.member?.memberId) ? (
            <div className="rounded-xl border border-brand/25 bg-brand/5 p-4">
              <h3 className="text-sm font-semibold text-ink">
                {label(fr, "LiteHubs sign-in access", "Accès de connexion LiteHubs")}
              </h3>
              <p className="mt-1 text-xs leading-5 text-ink-secondary">
                {label(
                  fr,
                  employee
                    ? "This employee does not yet have a LiteHubs account. Add their email to send secure access."
                    : "Required: every employee receives a LiteHubs account to view their schedule, tasks, attendance and permitted documents.",
                  employee
                    ? "Cet employé n’a pas encore de compte LiteHubs. Ajoutez son e-mail pour lui envoyer un accès sécurisé."
                    : "Obligatoire : chaque employé reçoit un compte LiteHubs pour consulter ses horaires, tâches, présence et documents autorisés.",
                )}
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field
                  label={label(fr, "LiteHubs sign-in email", "E-mail de connexion LiteHubs")}
                  htmlFor="employee-create-access-email"
                  required={!employee}
                >
                  <Input
                    id="employee-create-access-email"
                    name="accessEmail"
                    type="email"
                    autoComplete="email"
                    value={accessEmail}
                    onChange={(event) => setAccessEmail(event.target.value)}
                    placeholder={label(fr, "name@example.com", "nom@exemple.com")}
                    required={!employee}
                  />
                </Field>
                {hasAccessEmail ? (
                  <Field
                    label={label(fr, "LiteHubs role", "Rôle LiteHubs")}
                    htmlFor="employee-create-access-role"
                    required
                  >
                    <select
                      id="employee-create-access-role"
                      name="accessRoleCode"
                      className={selectClass}
                      defaultValue={
                        accessRolesForInvite.some((role) => role.code === "employee")
                          ? "employee"
                          : ""
                      }
                      required
                      disabled={!accessRolesForInvite.length}
                    >
                      <option value="">
                        {label(fr, "Select a role", "Sélectionnez un rôle")}
                      </option>
                      {accessRolesForInvite.map((role) => (
                        <option key={role.id} value={role.code}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : (
                  <div className="rounded-lg border border-dashed border-brand/25 bg-surface-1/70 px-3 py-2 text-xs leading-5 text-ink-muted">
                    {label(
                      fr,
                      "Enter the email, then choose the employee’s role and access scope here.",
                      "Saisissez l’e-mail, puis choisissez ici le rôle et le périmètre d’accès de l’employé.",
                    )}
                  </div>
                )}
              </div>
              {hasAccessEmail ? (
                <fieldset className="mt-4">
                  <legend className="text-xs font-semibold text-ink">
                    {label(fr, "Province access", "Accès aux provinces")}
                  </legend>
                  <p className="mt-1 text-xs text-ink-secondary">
                    {label(
                      fr,
                      "The employee province is used by default. Select extra provinces only if this role needs them.",
                      "La province de l’employé est utilisée par défaut. Sélectionnez d’autres provinces seulement si ce rôle en a besoin.",
                    )}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                    {selectableProvinces.map((province) => (
                      <label key={province.id} className="flex items-center gap-2 text-xs text-ink">
                        <input
                          type="checkbox"
                          checked={accessProvinceIds.includes(province.id)}
                          onChange={() =>
                            setAccessProvinceIds((current) =>
                              current.includes(province.id)
                                ? current.filter((id) => id !== province.id)
                                : [...current, province.id],
                            )
                          }
                          className="size-4 accent-[var(--brand)]"
                        />
                        {province.name}
                      </label>
                    ))}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-ink-secondary">
                    {label(
                      fr,
                      "When saved, LiteHubs sends a secure activation message. The employee chooses their own password; no password is sent by email.",
                      "À l’enregistrement, LiteHubs envoie un message d’activation sécurisé. L’employé choisit son mot de passe ; aucun mot de passe n’est envoyé par e-mail.",
                    )}
                  </p>
                </fieldset>
              ) : null}
            </div>
          ) : null}          <div>
            <h3 className="text-sm font-semibold text-ink">
              {label(fr, "Work assignment", "Affectation de travail")}
            </h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <Field
                label={label(fr, "Province", "Province")}
                htmlFor="employee-province"
              >
                <select
                  name="provinceId"
                  value={selectedProvince}
                  onChange={(event) => {
                    setSelectedProvince(event.target.value);
                    setSelectedSite("");
                  }}
                  className={selectClass}
                  required={restrictedCreation}
                >
                  {!restrictedCreation ? (
                    <option value="">
                      {label(
                        fr,
                        "Company-wide / no province",
                        "Toute l’entreprise / sans province",
                      )}
                    </option>
                  ) : null}
                  {selectableProvinces.map((province) => (
                    <option key={province.id} value={province.id}>
                      {province.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={label(fr, "Site / farm", "Site / ferme")}
                htmlFor="employee-site"
                hint={
                  !filteredSites.length
                    ? label(
                        fr,
                        "No eligible site is available.",
                        "Aucun site admissible n’est disponible.",
                      )
                    : undefined
                }
              >
                <select
                  name="siteId"
                  value={selectedSite}
                  onChange={(event) => setSelectedSite(event.target.value)}
                  className={selectClass}
                >
                  <option value="">
                    {label(fr, "No site assigned", "Aucun site affecté")}
                  </option>
                  {filteredSites.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={label(fr, "Department", "Département")}
                htmlFor="employee-department"
              >
                <select
                  name="departmentId"
                  defaultValue={employee?.department?.id ?? ""}
                  className={selectClass}
                >
                  <option value="">
                    {label(
                      fr,
                      "No department assigned",
                      "Aucun département affecté",
                    )}
                  </option>
                  {filteredDepartments.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink">
              {label(fr, "Employment", "Emploi")}
            </h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <Field
                label={label(fr, "Employment status", "Statut d’emploi")}
                htmlFor="employee-status"
              >
                <select
                  name="employmentStatus"
                  defaultValue={employee?.employment.status ?? "active"}
                  className={selectClass}
                >
                  {[
                    "active",
                    "probation",
                    "on_leave",
                    "suspended",
                    "terminated",
                  ].map((value) => (
                    <option key={value} value={value}>
                      {pretty(value)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={label(fr, "Employment type", "Type de contrat")}
                htmlFor="employee-type"
              >
                <select
                  name="employmentType"
                  defaultValue={employee?.employment.type ?? "permanent"}
                  className={selectClass}
                >
                  {[
                    "permanent",
                    "temporary",
                    "contract",
                    "casual",
                    "intern",
                  ].map((value) => (
                    <option key={value} value={value}>
                      {pretty(value)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={label(fr, "Start date", "Date de début")}
                htmlFor="employee-start-date"
                error={field("startDate")}
              >
                <Input
                  name="startDate"
                  type="date"
                  defaultValue={dateValue(employee?.employment.startDate)}
                  invalid={Boolean(field("startDate"))}
                />
              </Field>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink">
              {label(fr, "Contact and notes", "Contact et notes")}
            </h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field
                label={label(fr, "Phone", "Téléphone")}
                htmlFor="employee-phone"
              >
                <Input
                  name="phone"
                  defaultValue={employee?.contact.phone ?? ""}
                />
              </Field>
              <Field
                label={label(
                  fr,
                  "Emergency contact name",
                  "Nom du contact d’urgence",
                )}
                htmlFor="employee-emergency-name"
              >
                <Input
                  name="emergencyContactName"
                  defaultValue={employee?.contact.emergencyContactName ?? ""}
                />
              </Field>
              <Field
                label={label(
                  fr,
                  "Emergency contact phone",
                  "Téléphone du contact d’urgence",
                )}
                htmlFor="employee-emergency-phone"
              >
                <Input
                  name="emergencyContactPhone"
                  defaultValue={employee?.contact.emergencyContactPhone ?? ""}
                />
              </Field>
              <Field
                className="sm:col-span-2"
                label={label(fr, "Notes", "Notes")}
                htmlFor="employee-notes"
              >
                <Textarea name="notes" defaultValue={employee?.notes ?? ""} />
              </Field>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-5">
            <Button type="button" variant="secondary" onClick={onClose}>
              {label(fr, "Cancel", "Annuler")}
            </Button>
            <Button type="submit" loading={busy}>
              <FileText />
              {employee
                ? label(fr, "Save changes", "Enregistrer les modifications")
                : label(fr, "Create employee", "Créer l’employé")}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

function statusVariant(status: Employee["employment"]["status"]) {
  return status === "active"
    ? ("good" as const)
    : status === "on_leave" || status === "probation"
      ? ("warning" as const)
      : ("neutral" as const);
}
function uniqueProvinces(rows: Employee[]): Province[] {
  const seen = new Map<string, Province>();
  for (const row of rows)
    if (row.province?.id)
      seen.set(row.province.id, {
        id: row.province.id,
        code: row.province.code ?? row.province.id,
        name: row.province.name,
        isActive: true,
      });
  return [...seen.values()];
}
function uniqueSites(rows: Employee[]): Site[] {
  const seen = new Map<string, Site>();
  for (const row of rows)
    if (row.site?.id)
      seen.set(row.site.id, {
        id: row.site.id,
        code: row.site.code ?? row.site.id,
        name: row.site.name,
        province: row.province ?? { id: "", name: "" },
      });
  return [...seen.values()];
}
