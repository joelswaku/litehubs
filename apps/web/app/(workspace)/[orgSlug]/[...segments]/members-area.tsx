"use client";

import Link from "next/link";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Building2,
  ImagePlus,
  CheckCircle2,
  Clock3,
  Crown,
  Mail,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  Search,
  X,
  ChevronRight,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
  UserPlus,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import {
  EmptyState,
  ErrorState,
  NoAccessState,
  SkeletonCard,
} from "@/components/ui/states";
import { ApiError, api, get, orgUrl, patch } from "@/lib/api";
import {
  companySetupApi,
  type EmployeeCreationAllowance,
  type Invitation,
  type Member,
  type OrganizationRole,
  type OrganizationPermission,
  type OrganizationSite,
  type Province,
} from "@/lib/company-setup-api";
import { can, isOwner } from "@/lib/permissions";
import { initialsOf } from "@/lib/utils";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";

type EmployeeAccessCandidate = {
  id: string;
  employeeNumber: string;
  fullName: string;
  jobTitle: string;
  member?: { memberId: string; email?: string | null } | null;
  province?: { id: string; name: string } | null;
  employment: { status: string };
};

/**
 * Who is in the workspace, what they may do, and which provinces they can see.
 *
 * Both writes here are **PUT with the complete set**, not incremental adds. The
 * API replaces the member's roles and provinces outright, so the form always
 * submits every value the member should end up with — a partial list silently
 * removes the rest. That is why this is a checkbox panel with an explicit Save
 * rather than per-row toggles that fire on click: the user needs to see the
 * whole resulting set before committing it.
 *
 * The owner row is deliberately not editable. An owner who removes their own
 * owner role locks the company out of its own settings, and no UI affordance
 * should make that a single click.
 */
export function MembersArea({ orgSlug }: { orgSlug: string }) {
  const { t, locale } = useLanguage();
  const fr = locale === "fr";
  const user = useSessionUser();

  const canReadMembers = can(user, "members.read");
  const canUpdateMembers = can(user, "members.update");
  const canInviteMembers = can(user, "invitations.create");

  if (!isOwner(user) || !canReadMembers)
    return <NoAccessState what={t("members.title")} />;

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="relative overflow-hidden rounded-3xl border border-border bg-[radial-gradient(circle_at_91%_12%,rgba(37,99,235,.14),transparent_28%),radial-gradient(circle_at_8%_110%,rgba(45,212,191,.12),transparent_39%),linear-gradient(125deg,rgba(255,255,255,.98),rgba(241,245,249,.95)_52%,rgba(236,253,245,.90))] px-5 py-7 text-ink shadow-[0_28px_62px_-40px_rgba(15,23,42,.30)] dark:bg-surface-1 sm:px-7 sm:py-8">
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand">
              <ShieldCheck className="size-4" aria-hidden />
              {t("nav.settings")}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              {fr ? "Équipe et contrôle des accès" : "Team & access control"}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-ink-secondary">
              {fr
                ? "Gérez les personnes de l’entreprise, leurs rôles, leurs provinces autorisées et les limites de création d’employés."
                : "Manage the people in your company, their roles, authorised provinces and employee-creation limits."}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="rounded-2xl border border-border bg-surface-1/80 px-4 py-3 text-right shadow-sm backdrop-blur-sm">
              <p className="text-xs font-medium text-brand">{fr ? "Sécurisé par rôle et périmètre" : "Secure by role and scope"}</p>
              <p className="mt-1 flex items-center justify-end gap-1.5 text-sm font-semibold"><Building2 className="size-4" aria-hidden />{orgSlug}</p>
            </div>
            <Link href={`/${orgSlug}/performance`} className="inline-flex items-center gap-2 rounded-xl border border-brand/25 bg-brand-subtle px-3 py-2 text-xs font-semibold text-brand transition hover:border-brand/45 hover:bg-brand hover:text-white"><SlidersHorizontal className="size-4" />{fr ? "Règles de présence & performance" : "Attendance & performance rules"}</Link>
          </div>
        </div>
      </header>

      <CompanyProfileCard orgSlug={orgSlug} />

      <MemberList
        orgSlug={orgSlug}
        canUpdate={canUpdateMembers}
        canInvite={canInviteMembers}
      />
    </main>
  );
}

type CompanyProfile = {
  legalName: string;
  displayName: string;
  country: string | null;
  currency: string;
  timezone: string;
  logoUrl: string | null;
  address: { addressLine1: string | null; addressLine2: string | null; city: string | null; region: string | null; postalCode: string | null };
};

function CompanyProfileCard({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const queryClient = useQueryClient();
  const [editingAddress, setEditingAddress] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);
  const profile = useQuery({
    queryKey: ["workspace-profile", orgSlug],
    queryFn: () => get<{ organization: CompanyProfile }>(orgUrl(orgSlug, "")),
    select: (data) => data.organization,
  });
  const provinces = useQuery({
    queryKey: ["company-profile-provinces", orgSlug],
    queryFn: () => get<{ provinces: { id: string; name: string; code: string }[] }>(orgUrl(orgSlug, "provinces")),
    select: (data) => data.provinces,
  });
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => patch(orgUrl(orgSlug, "profile"), body),
    onSuccess: () => {
      setEditingAddress(false);
      void queryClient.invalidateQueries({ queryKey: ["workspace-profile", orgSlug] });
    },
  });
  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.set("file", file);
      const response = await api.post<{ organization: CompanyProfile }>(orgUrl(orgSlug, "profile/logo"), form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return response.data.organization;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["workspace-profile", orgSlug] }),
  });
  const blank = (value: FormDataEntryValue | null) => String(value ?? "").trim() || null;

  if (profile.isPending) return <SkeletonCard rows={3} />;
  if (profile.isError || !profile.data) {
    return <ErrorState title={fr ? "Impossible de charger le profil de l’entreprise" : "Could not load company profile"} description={profile.error instanceof Error ? profile.error.message : undefined} onRetry={() => void profile.refetch()} />;
  }

  const company = profile.data;
  const countryOptions = [
    { code: "CD", name: fr ? "République démocratique du Congo" : "Democratic Republic of the Congo" },
    { code: "CG", name: fr ? "République du Congo" : "Republic of the Congo" },
    { code: "AO", name: "Angola" }, { code: "ZM", name: "Zambia" },
    { code: "RW", name: "Rwanda" }, { code: "UG", name: "Uganda" },
  ];
  const addressLines = [
    company.address.addressLine1,
    company.address.addressLine2,
    [company.address.city, company.address.region].filter(Boolean).join(", "),
    company.address.postalCode,
    company.country ? (countryOptions.find((country) => country.code === company.country)?.name ?? company.country) : null,
  ].filter(Boolean);
  const submitAddress = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const requestedCountry = blank(form.get("country"));
    const requestedRegion = blank(form.get("region"));
    save.mutate({
      // A blank, unselected dropdown does not erase an existing official value.
      country: requestedCountry ?? company.country,
      address: {
        addressLine1: blank(form.get("addressLine1")),
        addressLine2: blank(form.get("addressLine2")),
        city: blank(form.get("city")),
        region: requestedRegion ?? company.address.region,
        postalCode: blank(form.get("postalCode")),
      },
    });
  };

  return <section className="overflow-hidden rounded-2xl border border-brand/20 bg-surface-1 shadow-[0_18px_44px_-34px_rgba(15,23,42,.52)]">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-[linear-gradient(120deg,rgba(20,184,166,.11),transparent_54%)] px-5 py-5">
      <div><div className="flex items-center gap-2"><span className="grid size-9 place-items-center rounded-xl border border-brand/20 bg-brand-subtle text-brand"><Building2 className="size-4" /></span><h2 className="text-base font-semibold text-ink">{fr ? "Profil officiel de l’entreprise" : "Official company profile"}</h2></div><p className="mt-2 max-w-2xl text-xs leading-5 text-ink-secondary">{fr ? "Cette adresse est utilisée automatiquement dans les contrats, documents et PDF de Congo Omega." : "This address is used automatically in Congo Omega contracts, documents, and PDFs."}</p></div>
      <Badge variant="info">{fr ? "Propriétaire uniquement" : "Owner only"}</Badge>
    </div>
    <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="flex min-w-0 items-start gap-4">
        {company.logoUrl ? <img src={company.logoUrl} alt={company.displayName} className="size-14 shrink-0 rounded-2xl border border-border bg-white object-contain p-1.5 shadow-sm" /> : <span className="grid size-14 shrink-0 place-items-center rounded-2xl border border-brand/20 bg-brand-subtle text-brand"><Building2 className="size-6" /></span>}
        <div className="min-w-0"><p className="text-xs font-medium uppercase tracking-[0.14em] text-ink-muted">{fr ? "Adresse et identité officielle" : "Official address and identity"}</p><p className="mt-2 text-sm font-semibold text-ink">{company.legalName || company.displayName}</p>{addressLines.length ? <div className="mt-1 space-y-0.5 text-sm leading-5 text-ink-secondary">{addressLines.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}</div> : <p className="mt-1 text-sm text-warning">{fr ? "Aucune adresse officielle enregistrée." : "No official address has been recorded."}</p>}<p className="mt-2 text-xs text-ink-muted">{company.logoUrl ? (fr ? "Logo intégré aux prochains PDF de contrats." : "Logo will be used in future contract PDFs.") : (fr ? "Ajoutez le logo officiel pour l’intégrer aux prochains PDF." : "Add the official logo to include it in future PDFs.")}</p></div>
      </div>
      <div className="flex flex-wrap gap-2"><input ref={logoInput} type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) uploadLogo.mutate(file); }} /><Button type="button" variant="secondary" loading={uploadLogo.isPending} onClick={() => logoInput.current?.click()}><ImagePlus />{company.logoUrl ? (fr ? "Remplacer le logo" : "Replace logo") : (fr ? "Ajouter le logo" : "Add logo")}</Button><Button type="button" variant="secondary" onClick={() => setEditingAddress(true)}><Pencil />{fr ? "Modifier l’adresse" : "Edit address"}</Button></div>
    </div>
    {uploadLogo.error ? <p className="mx-5 mb-5 rounded-xl border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical">{(uploadLogo.error as Error).message}</p> : null}
    {editingAddress ? <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="company-address-title">
      <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-border bg-surface-1 shadow-2xl sm:max-w-3xl sm:rounded-3xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-surface-1/95 px-5 py-4 backdrop-blur"><div><h3 id="company-address-title" className="text-lg font-semibold text-ink">{fr ? "Modifier l’adresse officielle" : "Edit official address"}</h3><p className="mt-1 text-sm text-ink-secondary">{fr ? "Cette adresse sera utilisée pour les prochains contrats et documents." : "This address will be used for future contracts and documents."}</p></div><Button type="button" variant="ghost" size="icon" aria-label={fr ? "Fermer" : "Close"} onClick={() => setEditingAddress(false)}><X /></Button></div>
        <form onSubmit={submitAddress} className="space-y-5 p-5"><div className="grid gap-4 sm:grid-cols-2"><Field label={fr ? "Adresse ligne 1" : "Address line 1"}><Input name="addressLine1" defaultValue={company.address.addressLine1 ?? ""} placeholder={fr ? "Ex. 12 avenue de la Paix" : "e.g. 12 Peace Avenue"} /></Field><Field label={fr ? "Adresse ligne 2" : "Address line 2"}><Input name="addressLine2" defaultValue={company.address.addressLine2 ?? ""} /></Field><Field label={fr ? "Ville" : "City"}><Input name="city" defaultValue={company.address.city ?? ""} /></Field><Field label={fr ? "Province / région" : "Province / region"}><select name="region" defaultValue="" className="h-10 w-full rounded-xl border border-border-strong bg-surface-1 px-3 text-sm text-ink"><option value="">{fr ? "Choisir une province" : "Choose a province"}</option>{company.address.region && !(provinces.data ?? []).some((province) => province.name === company.address.region) ? <option value={company.address.region}>{company.address.region}</option> : null}{(provinces.data ?? []).map((province) => <option key={province.id} value={province.name}>{province.name} · {province.code}</option>)}</select></Field><Field label={fr ? "Code postal" : "Postal code"}><Input name="postalCode" defaultValue={company.address.postalCode ?? ""} /></Field><Field label={fr ? "Pays" : "Country"}><select name="country" defaultValue="" className="h-10 w-full rounded-xl border border-border-strong bg-surface-1 px-3 text-sm text-ink"><option value="">{fr ? "Choisir un pays" : "Choose a country"}</option>{company.country && !countryOptions.some((country) => country.code === company.country) ? <option value={company.country}>{company.country}</option> : null}{countryOptions.map((country) => <option key={country.code} value={country.code}>{country.name} · {country.code}</option>)}</select></Field></div>{save.error ? <p className="rounded-xl border border-critical/30 bg-critical/10 p-3 text-sm text-critical">{(save.error as Error).message}</p> : null}<div className="flex flex-wrap justify-end gap-3 border-t border-border pt-5"><Button type="button" variant="ghost" onClick={() => setEditingAddress(false)}>{fr ? "Annuler" : "Cancel"}</Button><Button type="submit" loading={save.isPending}><Building2 />{fr ? "Enregistrer l’adresse" : "Save address"}</Button></div></form>
      </div>
    </div> : null}
  </section>;
}function SettingsOverview({
  members,
  roles,
  invitations,
  allowances,
  canManageLimits,
}: {
  members: Member[];
  roles: OrganizationRole[];
  invitations: Invitation[];
  allowances: EmployeeCreationAllowance[];
  canManageLimits: boolean;
}) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const activeMembers = members.filter(
    (member) => member.status === "active",
  ).length;
  const pendingInvitations = invitations.filter(
    (invitation) =>
      !invitation.acceptedAt &&
      !invitation.revokedAt &&
      new Date(invitation.expiresAt).getTime() >= Date.now(),
  ).length;
  const managers = members.filter((member) =>
    member.roleCodes.some(
      (code) =>
        code === "hr_officer" ||
        code === "manager" ||
        code.endsWith("_manager"),
    ),
  ).length;

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-border bg-surface-1 p-4 shadow-[0_14px_34px_-27px_rgba(15,23,42,.55)] transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md">
          <span className="grid size-9 place-items-center rounded-xl bg-brand/10 text-brand">
            <Users className="size-4" aria-hidden />
          </span>
          <p className="mt-4 text-2xl font-semibold tracking-tight text-ink">
            {members.length}
          </p>
          <p className="mt-1 text-xs font-medium text-ink-secondary">
            {fr ? "Membres de l’équipe" : "Team members"}
          </p>
        </article>
        <article className="rounded-2xl border border-border bg-surface-1 p-4 shadow-[0_14px_34px_-27px_rgba(15,23,42,.55)] transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md">
          <span className="grid size-9 place-items-center rounded-xl bg-good/15 text-good-ink">
            <BadgeCheck className="size-4" aria-hidden />
          </span>
          <p className="mt-4 text-2xl font-semibold tracking-tight text-ink">
            {activeMembers}
          </p>
          <p className="mt-1 text-xs font-medium text-ink-secondary">
            {fr ? "Comptes actifs" : "Active accounts"}
          </p>
        </article>
        <article className="rounded-2xl border border-border bg-surface-1 p-4 shadow-[0_14px_34px_-27px_rgba(15,23,42,.55)] transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md">
          <span className="grid size-9 place-items-center rounded-xl bg-warning/15 text-warning-ink">
            <Mail className="size-4" aria-hidden />
          </span>
          <p className="mt-4 text-2xl font-semibold tracking-tight text-ink">
            {pendingInvitations}
          </p>
          <p className="mt-1 text-xs font-medium text-ink-secondary">
            {fr
              ? "Affectations d’accès en attente"
              : "Pending access assignments"}
          </p>
        </article>
        <article className="rounded-2xl border border-border bg-surface-1 p-4 shadow-[0_14px_34px_-27px_rgba(15,23,42,.55)] transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md">
          <span className="grid size-9 place-items-center rounded-xl bg-surface-3 text-ink">
            <UserCog className="size-4" aria-hidden />
          </span>
          <p className="mt-4 text-2xl font-semibold tracking-tight text-ink">
            {canManageLimits ? allowances.length : managers}
          </p>
          <p className="mt-1 text-xs font-medium text-ink-secondary">
            {canManageLimits
              ? fr
                ? "Autorisations de recrutement"
                : "Hiring authorisations"
              : fr
                ? "RH et managers"
                : "HR & managers"}
          </p>
        </article>
      </section>

      <section className="grid gap-4 rounded-2xl border border-border bg-surface-1 p-5 shadow-sm lg:grid-cols-[1.1fr_.9fr] sm:p-6">
        <div>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-5 text-brand" aria-hidden />
            <h2 className="text-lg font-semibold text-ink">
              {fr
                ? "Accès clair, sans confusion"
                : "Clear access, without confusion"}
            </h2>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-secondary">
            {fr
              ? "Chaque personne reçoit un rôle, puis uniquement les provinces nécessaires. Les permissions sont appliquées par l’API : cacher un bouton ne donne jamais d’accès supplémentaire."
              : "Each person receives a role, then only the provinces they need. Permissions are enforced by the API: hiding a button never grants extra access."}
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <FlowStep
              index="1"
              label={fr ? "Inviter" : "Invite"}
              description={
                fr ? "Envoyer l’accès LiteHubs" : "Send LiteHubs access"
              }
            />
            <FlowStep
              index="2"
              label={fr ? "Affecter le rôle" : "Assign role"}
              description={
                fr
                  ? "Définir ce que la personne peut faire"
                  : "Set what the person can do"
              }
            />
            <FlowStep
              index="3"
              label={fr ? "Définir le périmètre" : "Set scope"}
              description={
                fr
                  ? "Limiter aux provinces utiles"
                  : "Limit to the needed provinces"
              }
            />
          </div>
        </div>
        <aside className="rounded-xl border border-brand/20 bg-brand/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand">
            {fr ? "Bon contrôle" : "Good control"}
          </p>
          <ul className="mt-3 space-y-3 text-sm leading-5 text-ink-secondary">
            <li className="flex gap-2">
              <CheckCircle2
                className="mt-0.5 size-4 shrink-0 text-good-ink"
                aria-hidden
              />
              {fr
                ? "Le propriétaire reste protégé et conserve l’administration complète."
                : "The Owner stays protected and retains complete administration."}
            </li>
            <li className="flex gap-2">
              <CheckCircle2
                className="mt-0.5 size-4 shrink-0 text-good-ink"
                aria-hidden
              />
              {fr
                ? "Les responsables RH et managers peuvent recevoir une limite de création d’employés par province."
                : "HR Officers and Managers can receive an employee-creation limit per province."}
            </li>
            <li className="flex gap-2">
              <CheckCircle2
                className="mt-0.5 size-4 shrink-0 text-good-ink"
                aria-hidden
              />
              {fr
                ? `${roles.length} rôle(s) prêt(s) à être affecté(s) dans l’équipe.`
                : `${roles.length} role(s) ready to assign in the team.`}
            </li>
          </ul>
        </aside>
      </section>
    </>
  );
}

function FlowStep({
  index,
  label,
  description,
}: {
  index: string;
  label: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3">
      <span className="grid size-6 place-items-center rounded-full bg-brand text-xs font-bold text-white">
        {index}
      </span>
      <p className="mt-2 text-sm font-semibold text-ink">{label}</p>
      <p className="mt-1 text-xs leading-5 text-ink-secondary">{description}</p>
    </div>
  );
}

const titleWords = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function RoleLibrary({ roles, orgSlug, canUpdate }: { roles: OrganizationRole[]; orgSlug: string; canUpdate: boolean }) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const permissions = useQuery({ queryKey: ["org-permissions", orgSlug], queryFn: () => companySetupApi.listPermissions<{ permissions: OrganizationPermission[] }>(orgSlug), enabled: Boolean(selectedId), select: (data) => data.permissions });
  const save = useMutation({ mutationFn: ({ roleId, permissionCodes }: { roleId: string; permissionCodes: string[] }) => companySetupApi.updateRole<{ role: OrganizationRole }>(orgSlug, roleId, { permissionCodes }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["org-roles", orgSlug] }); setSelectedId(null); } });
  const selected = roles.find((role) => role.id === selectedId) ?? null;
  if (!roles.length) return null;
  return <>
    <section className="overflow-hidden rounded-2xl border border-border-strong/80 bg-[radial-gradient(circle_at_top_right,rgba(26,115,232,.12),transparent_38%),radial-gradient(circle_at_bottom_left,rgba(16,185,129,.08),transparent_34%),var(--surface-1)] shadow-[0_20px_46px_-34px_rgba(15,23,42,.55)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-strong/80 bg-surface-1/70 p-5 sm:p-6"><div><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-brand" aria-hidden /><h2 className="text-base font-semibold text-ink">{fr ? "Bibliothèque de rôles" : "Role library"}</h2></div><p className="mt-1 max-w-2xl text-xs leading-5 text-ink-secondary">{fr ? "Ouvrez un rôle pour consulter toutes ses permissions et adapter les accès de l’entreprise. Le nom et le périmètre des rôles système restent protégés." : "Open a role to review every permission and tailor company access. Built-in role names and scopes remain protected."}</p></div><span className="inline-flex min-w-8 items-center justify-center rounded-full border border-brand/20 bg-brand-subtle px-2.5 py-1 text-xs font-bold text-brand">{roles.length}</span></div>
      <div className="grid gap-3 bg-surface-2/60 p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-3">
        {roles.map((role) => <button key={role.id} type="button" onClick={() => setSelectedId(role.id)} className={`group relative overflow-hidden rounded-xl border border-border-strong/80 p-4 text-left shadow-[0_12px_26px_-24px_rgba(15,23,42,.55)] transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${role.dataScope === "province" ? "bg-[linear-gradient(145deg,rgba(16,185,129,.09),var(--surface-1)_48%)]" : role.isSystem ? "bg-[linear-gradient(145deg,rgba(26,115,232,.09),var(--surface-1)_48%)]" : "bg-[linear-gradient(145deg,rgba(139,92,246,.08),var(--surface-1)_48%)]"}`} aria-label={fr ? `Ouvrir les permissions de ${role.name}` : `Open ${role.name} permissions`}>
          <span className={`absolute inset-x-0 top-0 h-0.5 ${role.dataScope === "province" ? "bg-good/70" : role.isSystem ? "bg-brand/70" : "bg-violet-500/70"}`} aria-hidden /><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-semibold text-ink">{role.name}</p><p className="mt-0.5 text-xs text-ink-muted">{role.code}</p></div><Badge variant={role.isSystem ? "outline" : "info"}>{role.isSystem ? (fr ? "Système" : "System") : (fr ? "Personnalisé" : "Custom")}</Badge></div><p className="mt-3 min-h-10 text-xs leading-5 text-ink-secondary">{role.description ?? (fr ? "Rôle configuré pour cette entreprise." : "Role configured for this company.")}</p><div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3"><div className="flex flex-wrap gap-1.5"><Badge variant="outline"><MapPin className="size-3" />{(role.dataScope ?? "organization").replace(/_/g, " ")}</Badge><Badge variant="outline"><ShieldCheck className="size-3" />{role.permissionCodes?.length ?? 0}</Badge></div><span className="inline-flex items-center gap-1 text-xs font-semibold text-brand opacity-80 transition group-hover:opacity-100">{fr ? "Permissions" : "Permissions"}<ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden /></span></div>
        </button>)}
      </div>
    </section>
    {selected ? <RolePermissionDialog role={selected} permissions={permissions.data ?? []} loading={permissions.isPending} error={permissions.error} fr={fr} canUpdate={canUpdate} saving={save.isPending} saveError={save.error} onClose={() => { setSelectedId(null); save.reset(); }} onSave={(permissionCodes) => save.mutate({ roleId: selected.id, permissionCodes })} /> : null}
  </>;
}

function RolePermissionDialog({ role, permissions, loading, error, fr, canUpdate, saving, saveError, onClose, onSave }: { role: OrganizationRole; permissions: OrganizationPermission[]; loading: boolean; error: unknown; fr: boolean; canUpdate: boolean; saving: boolean; saveError: unknown; onClose: () => void; onSave: (permissionCodes: string[]) => void }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(role.permissionCodes ?? []));
  const initialCodes = (role.permissionCodes ?? []).join("|");
  useEffect(() => { setSelected(new Set(role.permissionCodes ?? [])); setSearch(""); }, [role.id, initialCodes]);
  const protectedOwnerPermissions = new Set(role.code === "owner" ? ["organization.read", "organization.update", "members.read", "members.update", "roles.read", "roles.update"] : []);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const groups = useMemo(() => { const values = permissions.filter((permission) => [permission.code, permission.description ?? "", permission.moduleCode ?? "", permission.resource, permission.action].join(" ").toLocaleLowerCase().includes(normalizedSearch)); const grouped = new Map<string, OrganizationPermission[]>(); for (const permission of values) { const key = permission.moduleCode ?? permission.resource ?? "general"; grouped.set(key, [...(grouped.get(key) ?? []), permission]); } return [...grouped.entries()].map(([module, entries]) => ({ module, permissions: entries.sort((left, right) => left.code.localeCompare(right.code)) })).sort((left, right) => left.module.localeCompare(right.module)); }, [permissions, normalizedSearch]);
  const toggle = (code: string) => { if (!canUpdate || protectedOwnerPermissions.has(code)) return; setSelected((current) => { const next = new Set(current); if (next.has(code)) next.delete(code); else next.add(code); return next; }); };
  const message = (saveError instanceof ApiError ? saveError.message : null) ?? (error instanceof ApiError ? error.message : null);
  return <div className="fixed inset-0 z-[70] overflow-y-auto bg-ink/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={fr ? `Permissions : ${role.name}` : `Permissions: ${role.name}`}><section className="mx-auto my-5 w-full max-w-5xl overflow-hidden rounded-3xl border border-border-strong bg-surface-1 shadow-2xl">
    <header className="relative overflow-hidden border-b border-border bg-[radial-gradient(circle_at_92%_10%,rgba(37,99,235,.14),transparent_30%),linear-gradient(125deg,rgba(255,255,255,.98),rgba(241,245,249,.95))] p-5 dark:bg-surface-1 sm:p-6"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[.16em] text-brand">{fr ? "Contrôle des permissions" : "Permission control"}</p><h2 className="mt-1 truncate text-xl font-semibold tracking-tight text-ink">{role.name}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-ink-secondary">{fr ? "Cochez uniquement les actions que les personnes utilisant ce rôle peuvent effectuer. Les changements s’appliquent immédiatement à l’entreprise." : "Select only the actions people using this role may perform. Changes apply to the company immediately."}</p></div><Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={fr ? "Fermer" : "Close"}><X /></Button></div><div className="mt-4 flex flex-wrap gap-2"><Badge variant={role.isSystem ? "outline" : "info"}>{role.isSystem ? (fr ? "Rôle système" : "System role") : (fr ? "Rôle personnalisé" : "Custom role")}</Badge><Badge variant="outline"><MapPin className="size-3" />{titleWords(role.dataScope ?? "organization")}</Badge><Badge variant="outline"><ShieldCheck className="size-3" />{selected.size} {fr ? "permission(s) active(s)" : "active permission(s)"}</Badge></div>{role.code === "owner" ? <p className="mt-4 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning-ink">{fr ? "Les permissions essentielles de gestion de l’entreprise et des accès restent verrouillées afin d’éviter de bloquer le propriétaire hors des réglages." : "Core company and access-management permissions stay locked to prevent the Owner from being locked out of Settings."}</p> : null}</header>
    <div className="border-b border-border bg-surface-2/55 p-4 sm:px-6"><label className="relative block max-w-xl"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder={fr ? "Rechercher une permission, un module ou une action…" : "Search a permission, module or action…"} /></label></div>
    {message ? <p role="alert" className="mx-5 mt-5 rounded-xl border border-critical/30 bg-critical/10 px-4 py-3 text-sm text-critical sm:mx-6">{message}</p> : null}
    <div className="max-h-[58dvh] space-y-3 overflow-y-auto bg-surface-2/45 p-4 sm:p-6">{loading ? <SkeletonCard rows={8} /> : groups.length ? groups.map((group, index) => { const selectedCount = group.permissions.filter((permission) => selected.has(permission.code)).length; return <details key={group.module} open={Boolean(normalizedSearch) || index < 2} className="overflow-hidden rounded-2xl border border-border-strong/80 bg-surface-1 shadow-sm"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-[linear-gradient(115deg,rgba(20,184,166,.065),transparent_52%)] px-4 py-3.5 marker:hidden"><span><span className="block text-sm font-semibold text-ink">{titleWords(group.module)}</span><span className="mt-0.5 block text-xs text-ink-secondary">{group.permissions.length} {fr ? "permission(s)" : "permission(s)"}</span></span><Badge variant={selectedCount ? "good" : "outline"} icon={false}>{selectedCount} {fr ? "activée(s)" : "enabled"}</Badge></summary><div className="divide-y divide-border">{group.permissions.map((permission) => { const checked = selected.has(permission.code); const locked = protectedOwnerPermissions.has(permission.code); return <label key={permission.code} className={`flex cursor-pointer items-start gap-3 px-4 py-3 transition ${checked ? "bg-brand-subtle/45" : "hover:bg-surface-2"} ${locked || !canUpdate ? "cursor-not-allowed opacity-75" : ""}`}><input type="checkbox" checked={checked} disabled={locked || !canUpdate} onChange={() => toggle(permission.code)} className="mt-0.5 size-4 accent-[var(--brand)]" /><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-ink">{permission.description || titleWords(permission.resource + " " + permission.action)}</span>{locked ? <Badge variant="warning" icon={false}>{fr ? "Protégée" : "Protected"}</Badge> : null}</span><span className="mt-1 block break-all font-mono text-[11px] text-ink-muted">{permission.code}</span></span></label>; })}</div></details>; }) : <EmptyState icon={ShieldCheck} title={fr ? "Aucune permission trouvée" : "No permission found"} description={fr ? "Essayez un autre terme de recherche." : "Try another search term."} />}</div>
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-1 p-4 sm:px-6"><p className="text-xs text-ink-secondary">{canUpdate ? (fr ? "Le rôle conserve au moins une permission active." : "The role must keep at least one active permission.") : (fr ? "Vous pouvez consulter les permissions, mais seul le propriétaire peut les modifier." : "You can review permissions, but only the Owner can change them.")}</p><div className="flex gap-2"><Button variant="secondary" onClick={onClose}>{fr ? "Annuler" : "Cancel"}</Button>{canUpdate ? <Button disabled={selected.size === 0} loading={saving} onClick={() => onSave([...selected].sort())}>{fr ? "Enregistrer les permissions" : "Save permissions"}</Button> : null}</div></footer>
  </section></div>;
}
function MemberList({
  orgSlug,
  canUpdate,
  canInvite,
}: {
  orgSlug: string;
  canUpdate: boolean;
  canInvite: boolean;
}) {
  const { t, locale } = useLanguage();
  const fr = locale === "fr";
  const user = useSessionUser();
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const members = useQuery({
    queryKey: ["org-members", orgSlug],
    queryFn: () => companySetupApi.listMembers<{ members: Member[] }>(orgSlug),
    select: (data) => data.members,
  });

  const roles = useQuery({
    queryKey: ["org-roles", orgSlug],
    queryFn: () =>
      companySetupApi.listRoles<{ roles: OrganizationRole[] }>(orgSlug),
    enabled: can(user, "roles.read"),
    select: (data) => data.roles,
  });

  const provinces = useQuery({
    queryKey: ["org-provinces", orgSlug],
    queryFn: () =>
      companySetupApi.listProvinces<{ provinces: Province[] }>(orgSlug),
    enabled: can(user, "sites.read") || can(user, "members.update"),
    select: (data) => data.provinces,
  });

  const creationAllowances = useQuery({
    queryKey: ["employee-creation-allowances", orgSlug],
    queryFn: () =>
      companySetupApi.listEmployeeCreationAllowances<{
        allowances: EmployeeCreationAllowance[];
      }>(orgSlug),
    enabled: isOwner(user) && can(user, "employees.read"),
    select: (data) => data.allowances,
  });
  const employees = useQuery({
    queryKey: ["settings-employees", orgSlug],
    queryFn: () =>
      get<{ employees: EmployeeAccessCandidate[] }>(orgUrl(orgSlug, "employees")),
    enabled: isOwner(user) && can(user, "employees.read"),
    select: (data) => data.employees,
  });
  const invitations = useQuery({
    queryKey: ["org-invitations", orgSlug],
    queryFn: () =>
      companySetupApi.listAccessAssignments<{ invitations: Invitation[] }>(
        orgSlug,
      ),
    enabled: can(user, "invitations.read"),
    select: (data) => data.invitations,
  });

  if (members.isPending) return <SkeletonCard rows={6} />;
  if (members.isError) {
    return (
      <ErrorState
        description={(members.error as ApiError)?.message}
        onRetry={() => void members.refetch()}
      />
    );
  }

  const rows = members.data ?? [];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredRows = normalizedQuery
    ? rows.filter((member) =>
        [
          member.fullName,
          member.email,
          member.jobTitle ?? "",
          ...member.roleCodes,
          ...member.provinces.map((province) => province.name),
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalizedQuery),
      )
    : rows;

  const employeesWithoutAccess = (employees.data ?? []).filter(
    (employee) =>
      !employee.member?.memberId && employee.employment.status !== "terminated",
  );
  const pendingEmployeeIds = new Set(
    (invitations.data ?? [])
      .filter((invitation) => !invitation.acceptedAt && !invitation.revokedAt)
      .flatMap((invitation) =>
        invitation.employeeId ? [invitation.employeeId] : [],
      ),
  );
  const roleLabel = (code: string) =>
    code.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const statusLabel = (status: string) => {
    const labels: Record<string, string> = fr
      ? { active: "Actif", suspended: "Suspendu", inactive: "Inactif" }
      : { active: "Active", suspended: "Suspended", inactive: "Inactive" };
    return labels[status] ?? roleLabel(status);
  };

  return (
    <>
      <SettingsOverview
        members={rows}
        roles={roles.data ?? []}
        invitations={invitations.data ?? []}
        allowances={creationAllowances.data ?? []}
        canManageLimits={isOwner(user) && can(user, "employees.read")}
      />

      <section className="overflow-hidden rounded-2xl border border-border-strong/80 bg-surface-1 shadow-[0_20px_46px_-34px_rgba(15,23,42,.55)]">
        {" "}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-strong/80 bg-surface-1 p-4 sm:p-5">
          <div>
            <h2 className="text-sm font-semibold text-ink">
              {t("members.team")}
            </h2>
            <p className="mt-0.5 text-xs text-ink-secondary">
              {t("members.count", { count: rows.length })}
            </p>
          </div>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <label className="relative min-w-48 max-w-xs flex-1 sm:flex-none">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-muted"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("members.search")}
                aria-label={t("members.search")}
                className="pl-8"
              />
            </label>
            {canInvite ? (
              <InviteMember
                orgSlug={orgSlug}
                roles={roles.data ?? []}
                provinces={provinces.data ?? []}
              />
            ) : null}
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title={t("members.none")}
            description={t("members.noneDescription")}
            icon={Users}
          />
        ) : filteredRows.length === 0 ? (
          <EmptyState
            title={t("members.noSearchResults")}
            description={t("members.noSearchResultsDescription")}
            icon={Search}
          />
        ) : (
          <ul className="grid gap-4 bg-surface-2/70 p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-3">
            {filteredRows.map((member) => {
              const accessScope =
                member.provinces.length === 0
                  ? t("members.allProvinces")
                  : member.provinces
                      .map((province) => province.name)
                      .join(", ");

              return (
                <li
                  key={member.memberId}
                  className="group overflow-hidden rounded-2xl border border-border-strong bg-surface-1 ring-1 ring-black/[.025] shadow-[0_16px_34px_-26px_rgba(15,23,42,.48)] transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/45 hover:shadow-[0_22px_42px_-28px_rgba(15,23,42,.5)]"
                >
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className="grid size-11 shrink-0 place-items-center rounded-xl border border-brand/25 bg-brand text-sm font-bold text-white shadow-[0_8px_18px_-10px_color-mix(in_srgb,var(--brand)_80%,transparent)]"
                          aria-hidden
                        >
                          {initialsOf(member.fullName)}
                        </span>
                        <div className="min-w-0">
                          <p className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold text-ink">
                            <span className="truncate">{member.fullName}</span>
                            {member.isOwner ? (
                              <Crown
                                className="size-4 shrink-0 text-warning"
                                aria-label={t("members.owner")}
                              />
                            ) : null}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-ink-secondary">
                            {member.email}
                          </p>
                          {member.jobTitle ? (
                            <p className="mt-1 truncate text-xs font-medium text-ink-muted">
                              {member.jobTitle}
                            </p>
                          ) : null}
                          {member.employee?.employeeNumber ? (
                            <p className="mt-1 text-[11px] font-semibold tracking-wide text-brand">
                              #{member.employee.employeeNumber}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <Badge
                        variant={
                          member.status === "active" ? "good" : "warning"
                        }
                        icon={false}
                      >
                        {statusLabel(member.status)}
                      </Badge>
                    </div>

                    <div className="mt-4 rounded-xl border border-border-strong/80 bg-surface-2 p-3 shadow-inner shadow-black/[.018]">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                        {fr ? "Rôles d’accès" : "Access roles"}
                      </p>
                      <div className="mt-2 flex min-h-7 flex-wrap gap-1.5">
                        {member.roleCodes.length === 0 ? (
                          <Badge variant="warning" icon={false}>
                            {t("members.noRole")}
                          </Badge>
                        ) : (
                          member.roleCodes.map((code) => (
                            <span key={code} className="inline-flex items-center rounded-md border border-brand/20 bg-brand-subtle px-2 py-1 text-[11px] font-semibold text-brand">
                              {roleLabel(code)}
                            </span>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex items-start gap-2 rounded-xl border border-border-strong/80 bg-[linear-gradient(135deg,var(--surface-1),var(--surface-2))] px-3 py-2.5">
                      <MapPin
                        className="mt-0.5 size-3.5 shrink-0 text-brand"
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                          {fr ? "Périmètre" : "Scope"}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-xs font-medium text-ink-secondary">
                          {accessScope}
                        </p>
                      </div>
                    </div>
                  </div>

                  {canUpdate && !member.isOwner ? (
                    <div className="border-t border-border-strong/80 bg-surface-2 p-3">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="w-full justify-between transition-colors group-hover:border-brand/30"
                        onClick={() =>
                          setEditing((current) =>
                            current === member.memberId
                              ? null
                              : member.memberId,
                          )
                        }
                      >
                        <UserCog />
                        {editing === member.memberId
                          ? t("members.close")
                          : t("members.manageAccess")}
                      </Button>
                    </div>
                  ) : null}

                  {editing === member.memberId ? (
                    <AccessEditor
                      orgSlug={orgSlug}
                      member={member}
                      roles={roles.data ?? []}
                      provinces={provinces.data ?? []}
                      allowances={creationAllowances.data ?? []}
                      canManageCreationLimits={isOwner(user)}
                      onDone={() => setEditing(null)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {canInvite ? (
        <section className="overflow-hidden rounded-2xl border border-border-strong/80 bg-surface-1 shadow-[0_20px_46px_-34px_rgba(15,23,42,.55)]">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
            <div>
              <h2 className="text-sm font-semibold text-ink">
                {fr ? "Employés sans accès LiteHubs" : "Employees without LiteHubs access"}
              </h2>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-secondary">
                {fr
                  ? "Ces fiches RH n’ont pas encore de compte. Attribuez un rôle et envoyez une invitation sécurisée sans créer une seconde fiche employé."
                  : "These HR profiles do not yet have an account. Assign a role and send a secure invitation without creating a second employee profile."}
              </p>
            </div>
            <Badge variant="outline" icon={false}>
              {employeesWithoutAccess.length}
            </Badge>
          </div>
          {employees.isPending ? <SkeletonCard rows={2} /> : null}
          {!employees.isPending && employeesWithoutAccess.length === 0 ? (
            <p className="p-4 text-sm text-ink-secondary">
              {fr ? "Tous les employés actifs ont déjà un accès ou aucune fiche n’est disponible." : "Every active employee already has access, or no employee profile is available."}
            </p>
          ) : null}
          {!employees.isPending && employeesWithoutAccess.length ? (
            <ul className="divide-y divide-border">
              {employeesWithoutAccess.map((employee) => (
                <li
                  key={employee.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">
                      {employee.fullName}
                      <span className="ml-2 text-xs text-brand">
                        #{employee.employeeNumber}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-ink-secondary">
                      {[employee.jobTitle, employee.province?.name]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </p>
                    {pendingEmployeeIds.has(employee.id) ? (
                      <Badge className="mt-2" variant="warning" icon={false}>
                        {fr ? "Invitation en attente" : "Invitation pending"}
                      </Badge>
                    ) : null}
                  </div>
                  {!pendingEmployeeIds.has(employee.id) ? (
                    <InviteMember
                      orgSlug={orgSlug}
                      roles={roles.data ?? []}
                      provinces={provinces.data ?? []}
                      employee={employee}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {can(user, "invitations.read") ? (
        <InvitationPanel
          orgSlug={orgSlug}
          invitations={invitations.data ?? []}
          isPending={invitations.isPending}
          isError={invitations.isError}
          error={invitations.error}
          canRevoke={can(user, "invitations.update")}
          onRetry={() => void invitations.refetch()}
        />
      ) : null}

      {can(user, "roles.read") ? (
        <RoleLibrary roles={roles.data ?? []} orgSlug={orgSlug} canUpdate={canUpdate && isOwner(user)} />
      ) : null}
    </>
  );
}

function InvitationPanel({
  orgSlug,
  invitations,
  isPending,
  isError,
  error,
  canRevoke,
  onRetry,
}: {
  orgSlug: string;
  invitations: Invitation[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  canRevoke: boolean;
  onRetry: () => void;
}) {
  const { t, locale } = useLanguage();
  const fr = locale === "fr";
  const queryClient = useQueryClient();
  const revoke = useMutation({
    mutationFn: (invitationId: string) =>
      companySetupApi.revokeAccessAssignment(orgSlug, invitationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["org-invitations", orgSlug],
      });
    },
  });
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
      new Date(value),
    );
  const pending = invitations.filter(
    (invitation) =>
      !invitation.acceptedAt &&
      !invitation.revokedAt &&
      new Date(invitation.expiresAt).getTime() >= Date.now(),
  );

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface-1">
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div>
          <div className="flex items-center gap-2">
            <Mail className="size-4 text-brand" aria-hidden />
            <h2 className="text-sm font-semibold text-ink">
              {t("members.pendingInvitations")}
            </h2>
            <Badge variant="outline" icon={false}>
              {pending.length}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-ink-secondary">
            {t("members.invitationsDescription")}
          </p>
        </div>
      </div>

      {isPending ? <SkeletonCard rows={2} /> : null}
      {isError ? (
        <ErrorState
          description={(error as ApiError)?.message}
          onRetry={onRetry}
        />
      ) : null}
      {!isPending && !isError && pending.length === 0 ? (
        <EmptyState
          title={t("members.noPendingInvitations")}
          description={t("members.noPendingInvitationsDescription")}
          icon={Mail}
        />
      ) : null}
      {!isPending && !isError && pending.length ? (
        <ul className="divide-y divide-border">
          {pending.map((invitation) => (
            <li
              key={invitation.invitationId}
              className="flex flex-wrap items-start justify-between gap-3 p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">
                  {invitation.email}
                </p>
                {invitation.employeeName ? (
                  <p className="mt-0.5 text-xs text-ink-secondary">
                    {fr ? "Employé : " : "Employee: "}
                    {invitation.employeeName}
                  </p>
                ) : null}
                {invitation.jobTitle ? (
                  <p className="mt-0.5 text-xs text-ink-secondary">
                    {invitation.jobTitle}
                  </p>
                ) : null}
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {invitation.roleCodes.map((roleCode) => (
                    <Badge key={roleCode} variant="outline" icon={false}>
                      {roleCode.replace(/_/g, " ")}
                    </Badge>
                  ))}
                </div>
                <p className="mt-2 flex items-center gap-1 text-xs text-ink-muted">
                  <Clock3 className="size-3" aria-hidden />
                  {t("members.invitationExpires", {
                    date: date(invitation.expiresAt),
                  })}
                </p>
              </div>
              {canRevoke ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={revoke.isPending}
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(invitation.invitationId)}
                >
                  {t("members.revokeInvitation")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {revoke.isError ? (
        <p
          className="border-t border-border p-3 text-xs text-critical"
          role="alert"
        >
          {revoke.error instanceof ApiError
            ? revoke.error.message
            : t("members.revokeFailed")}
        </p>
      ) : null}
    </section>
  );
}
/**
 * The role and province editor for one member.
 *
 * Roles and provinces are saved by two separate API calls because they are two
 * separate PUTs, and they can fail independently — the save reports which of
 * the two did not land rather than a single blanket failure.
 */
/** Owner-only delegation. A limit applies to one person and one province.
 * The API reserves a slot atomically, so concurrent browser sessions cannot
 * create more employee records than the Owner authorised. */
function CreationAllowanceEditor({
  orgSlug,
  member,
  allowances,
}: {
  orgSlug: string;
  member: Member;
  allowances: EmployeeCreationAllowance[];
}) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const queryClient = useQueryClient();
  const [provinceId, setProvinceId] = useState("");
  const [maximum, setMaximum] = useState("2");
  const eligible = member.roleCodes.some(
    (code) =>
      code === "hr_officer" || code === "manager" || code.endsWith("_manager"),
  );
  const rows = allowances.filter((entry) => entry.memberId === member.memberId);
  const availableProvinces = member.provinces.filter(
    (province) => !rows.some((entry) => entry.province.id === province.id),
  );
  const save = useMutation({
    mutationFn: () =>
      companySetupApi.setEmployeeCreationAllowance<{
        allowance: EmployeeCreationAllowance;
      }>(orgSlug, member.memberId, provinceId, Number(maximum)),
    onSuccess: () => {
      setProvinceId("");
      setMaximum("2");
      void queryClient.invalidateQueries({
        queryKey: ["employee-creation-allowances", orgSlug],
      });
    },
  });
  const remove = useMutation({
    mutationFn: (currentProvinceId: string) =>
      companySetupApi.removeEmployeeCreationAllowance(
        orgSlug,
        member.memberId,
        currentProvinceId,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["employee-creation-allowances", orgSlug],
      });
    },
  });
  const failure =
    save.error instanceof ApiError
      ? save.error.message
      : remove.error instanceof ApiError
        ? remove.error.message
        : save.error || remove.error
          ? fr
            ? "Impossible de mettre à jour la limite."
            : "The limit could not be updated."
          : null;

  return (
    <section className="sm:col-span-2 rounded-xl border border-brand/20 bg-brand/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">
            {fr
              ? "Autorisation de création d’employés"
              : "Employee-creation authorisation"}
          </h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-secondary">
            {fr
              ? "Le propriétaire fixe ici le nombre maximum de fiches employés qu’un responsable RH ou manager peut créer dans chaque province."
              : "The Owner sets the maximum number of employee profiles this HR Officer or Manager may create in each province."}
          </p>
        </div>
        <Badge variant={eligible ? "good" : "warning"}>
          {eligible
            ? fr
              ? "Éligible"
              : "Eligible"
            : fr
              ? "Rôle non éligible"
              : "Role not eligible"}
        </Badge>
      </div>

      {!eligible ? (
        <p className="mt-3 text-xs text-ink-secondary">
          {fr
            ? "Attribuez d’abord le rôle Responsable RH ou Manager, puis enregistrez l’accès avant de définir une limite."
            : "First assign the HR Officer or Manager role and save access before setting a limit."}
        </p>
      ) : member.provinces.length === 0 ? (
        <p className="mt-3 text-xs text-ink-secondary">
          {fr
            ? "Aucune province n’est encore affectée. Attribuez une province et enregistrez l’accès avant de définir une limite."
            : "No province is assigned yet. Assign a province and save access before setting a limit."}
        </p>
      ) : (
        <>
          <div className="mt-3 space-y-2">
            {rows.length ? (
              rows.map((entry) => (
                <div
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-1 px-3 py-2.5"
                >
                  <div>
                    <p className="text-sm font-medium text-ink">
                      {entry.province.name}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-secondary">
                      {fr ? "Utilisés" : "Used"} {entry.usedEmployees} /{" "}
                      {entry.maxEmployees}
                      {" · "}
                      <strong className="text-ink">
                        {entry.remainingEmployees}{" "}
                        {fr ? "restant(s)" : "remaining"}
                      </strong>
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    loading={remove.isPending}
                    onClick={() => remove.mutate(entry.province.id)}
                  >
                    {fr ? "Retirer" : "Remove"}
                  </Button>
                </div>
              ))
            ) : (
              <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-ink-muted">
                {fr
                  ? "Aucune autorisation accordée pour le moment."
                  : "No creation authorisation has been granted yet."}
              </p>
            )}
          </div>
          {availableProvinces.length ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
              <select
                value={provinceId}
                onChange={(event) => setProvinceId(event.target.value)}
                className="h-9 rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
              >
                <option value="">
                  {fr ? "Choisir une province" : "Choose a province"}
                </option>
                {availableProvinces.map((province) => (
                  <option key={province.id} value={province.id}>
                    {province.name}
                  </option>
                ))}
              </select>
              <Input
                type="number"
                min="1"
                max="100000"
                value={maximum}
                onChange={(event) => setMaximum(event.target.value)}
                aria-label={
                  fr
                    ? "Nombre maximal d’employés"
                    : "Maximum number of employees"
                }
              />
              <Button
                type="button"
                size="sm"
                loading={save.isPending}
                disabled={
                  !provinceId ||
                  !Number.isInteger(Number(maximum)) ||
                  Number(maximum) < 1
                }
                onClick={() => save.mutate()}
              >
                {fr ? "Accorder" : "Grant"}
              </Button>
            </div>
          ) : null}
        </>
      )}
      {failure ? (
        <p className="mt-3 text-xs text-critical" role="alert">
          {failure}
        </p>
      ) : null}
    </section>
  );
}
function InviteMember({
  orgSlug,
  roles,
  provinces,
  employee,
}: {
  orgSlug: string;
  roles: OrganizationRole[];
  provinces: Province[];
  employee?: EmployeeAccessCandidate;
}) {
  const { t, locale } = useLanguage();
  const fr = locale === "fr";
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [provinceIds, setProvinceIds] = useState<string[]>(
    employee?.province?.id ? [employee.province.id] : [],
  );
  const [successEmail, setSuccessEmail] = useState<string | null>(null);
  const assignableRoles = roles.filter((role) => role.code !== "owner");
  const invite = useMutation({
    mutationFn: (body: {
      email: string;
      jobTitle?: string;
      employeeId?: string;
      roleCodes: string[];
      provinceIds: string[];
    }) => companySetupApi.assignAccess(orgSlug, body),
    onSuccess: (_result, variables) => {
      setSuccessEmail(variables.email);
      setProvinceIds([]);
      setOpen(false);
      void queryClient.invalidateQueries({
        queryKey: ["org-invitations", orgSlug],
      });
    },
  });
  const toggleProvince = (provinceId: string) =>
    setProvinceIds((current) =>
      current.includes(provinceId)
        ? current.filter((id) => id !== provinceId)
        : [...current, provinceId],
    );
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    invite.mutate({
      email: String(form.get("email") ?? "")
        .trim()
        .toLowerCase(),
      jobTitle:
        String(form.get("jobTitle") ?? "").trim() || employee?.jobTitle || undefined,
      employeeId: employee?.id,
      roleCodes: [String(form.get("roleCode") ?? "")],
      provinceIds,
    });
  };
  const failure =
    invite.error instanceof ApiError
      ? invite.error.message
      : invite.error
        ? t("members.inviteFailed")
        : null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {successEmail ? (
        <span className="text-xs text-good-ink" role="status">
          {t("members.inviteSuccess", { email: successEmail })}
        </span>
      ) : null}
      <Button
        size="sm"
        onClick={() => {
          setSuccessEmail(null);
          setOpen((current) => !current);
        }}
      >
        <UserPlus />
        {open
          ? t("members.cancel")
          : employee
            ? fr
              ? "Donner accès"
              : "Grant access"
            : t("members.invite")}
      </Button>
      {open ? (
        <form
          className="mt-2 grid w-full gap-3 rounded-lg border border-brand/25 bg-surface-2 p-4 sm:grid-cols-2"
          onSubmit={submit}
          noValidate
        >
          <Field
            label={t("members.inviteEmail")}
            htmlFor="invite-email"
            required
          >
            <Input
              id="invite-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              autoFocus
            />
          </Field>
          <Field label={t("members.inviteJobTitle")} htmlFor="invite-job-title">
            <Input
              id="invite-job-title"
              name="jobTitle"
              autoComplete="organization-title"
              defaultValue={employee?.jobTitle ?? ""}
            />
          </Field>
          <Field
            label={t("members.inviteRole")}
            hint={t("members.inviteRoleHint")}
            htmlFor="invite-role"
            required
          >
            <select
              id="invite-role"
              name="roleCode"
              required
              defaultValue=""
              className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
            >
              <option value="">{t("members.chooseRole")}</option>
              {assignableRoles.map((role) => (
                <option key={role.code} value={role.code}>
                  {role.name}
                </option>
              ))}
            </select>
          </Field>
          <fieldset className="sm:col-span-2">
            <legend className="text-xs font-semibold text-ink">
              {t("members.provinces")}
            </legend>
            <p className="mt-1 text-xs text-ink-secondary">
              {t("members.inviteProvincesHint")}
            </p>
            {provinces.length ? (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                {provinces.map((province) => (
                  <label
                    key={province.id}
                    className="flex items-center gap-2 text-xs text-ink"
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
            ) : null}
          </fieldset>
          {failure ? (
            <p className="sm:col-span-2 text-xs text-critical" role="alert">
              {failure}
            </p>
          ) : null}
          <div className="flex justify-end sm:col-span-2">
            <Button
              type="submit"
              loading={invite.isPending}
              disabled={!assignableRoles.length}
            >
              <UserPlus />
              {t("members.sendInvitation")}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
function AccessEditor({
  orgSlug,
  member,
  roles,
  provinces,
  allowances,
  canManageCreationLimits,
  onDone,
}: {
  orgSlug: string;
  member: Member;
  roles: OrganizationRole[];
  provinces: Province[];
  allowances: EmployeeCreationAllowance[];
  canManageCreationLimits: boolean;
  onDone: () => void;
}) {

  const { t, locale } = useLanguage();
  const fr = locale === "fr";
  const queryClient = useQueryClient();

  const assignableRoles = roles.filter((role) => role.code !== "owner");
  const mustKeepEmployeeRole =
    Boolean(member.employee) &&
    assignableRoles.some((role) => role.code === "employee");
  const keepEmployeeRole = (codes: string[]) =>
    mustKeepEmployeeRole && !codes.includes("employee")
      ? [...codes, "employee"]
      : codes;
  const [roleCodes, setRoleCodes] = useState<string[]>(() =>
    keepEmployeeRole(member.roleCodes),
  );
  const [provinceIds, setProvinceIds] = useState<string[]>(
    member.provinces.map((province) => province.id),
  );

  // Re-seed when the underlying member changes (a refetch after saving), so the
  // form reflects what the server stored rather than what was typed.
  useEffect(() => {
    setRoleCodes(keepEmployeeRole(member.roleCodes));
    setProvinceIds(member.provinces.map((province) => province.id));
  }, [member, mustKeepEmployeeRole]);

  const rolesChanged = useMemo(
    () =>
      [...roleCodes].sort().join(",") !==
      [...member.roleCodes].sort().join(","),
    [roleCodes, member.roleCodes],
  );
  const provincesChanged = useMemo(
    () =>
      [...provinceIds].sort().join(",") !==
      [...member.provinces.map((p) => p.id)].sort().join(","),
    [provinceIds, member.provinces],
  );

  const save = useMutation({
    mutationFn: async () => {
      const failures: string[] = [];
      if (rolesChanged) {
        try {
          await companySetupApi.replaceMemberRoles(
            orgSlug,
            member.memberId,
            roleCodes,
          );
        } catch (error) {
          failures.push(
            error instanceof ApiError
              ? error.message
              : t("members.rolesFailed"),
          );
        }
      }
      if (provincesChanged) {
        try {
          await companySetupApi.replaceMemberProvinces(
            orgSlug,
            member.memberId,
            provinceIds,
          );
        } catch (error) {
          failures.push(
            error instanceof ApiError
              ? error.message
              : t("members.provincesFailed"),
          );
        }
      }
      if (failures.length) throw new Error(failures.join(" "));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["org-members", orgSlug],
      });
      // The caller's own permissions may have just changed if they edited
      // themselves, so the session is refreshed too.
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      onDone();
    },
  });

  const toggle = (list: string[], value: string) =>
    list.includes(value)
      ? list.filter((item) => item !== value)
      : [...list, value];

  const failure = save.error instanceof Error ? save.error.message : null;
  const dirty = rolesChanged || provincesChanged;

  return (
    <div className="border-t border-border bg-surface-2 p-4">
      <div className="grid gap-5 sm:grid-cols-2">
        <fieldset>
          <legend className="flex items-center gap-1.5 text-xs font-semibold text-ink">
            <ShieldCheck className="size-3.5" aria-hidden />
            {t("members.roles")}
          </legend>
          <p className="mt-1 text-xs text-ink-secondary">
            {t("members.rolesHint")}
          </p>

          <div className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1 scrollbar-thin">
            {assignableRoles.length === 0 ? (
              <p className="text-xs text-ink-muted">
                {t("members.noRolesLoaded")}
              </p>
            ) : (
              assignableRoles.map((role) => (
                <label
                  key={role.code}
                  className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 hover:bg-surface-1"
                >
                  <input
                    type="checkbox"
                    checked={roleCodes.includes(role.code)}
                    onChange={() =>
                      setRoleCodes((list) =>
                        keepEmployeeRole(toggle(list, role.code)),
                      )
                    }
                    disabled={mustKeepEmployeeRole && role.code === "employee"}
                    className="mt-0.5 size-4 accent-[var(--brand)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-ink">
                      {role.name}
                    </span>
                    {role.description ? (
                      <span className="block text-xs text-ink-muted">
                        {role.description}
                      </span>
                    ) : null}
                  </span>
                </label>
              ))
            )}
          </div>

          {mustKeepEmployeeRole ? (
            <p className="mt-2 rounded-lg bg-brand/5 px-2.5 py-2 text-xs leading-5 text-ink-secondary">
              {fr
                ? "Cette personne reste employée : le rôle Employé conserve son espace personnel (horaire, congés, présence, documents et paie autorisée) en plus de ses responsabilités de supervision ou de gestion."
                : "This person remains an employee: the Employee role keeps their personal space (schedule, leave, attendance, permitted documents and payroll) alongside any supervisor or management responsibilities."}
            </p>
          ) : null}
          {roleCodes.length === 0 ? (
            <p className="mt-1.5 text-xs text-critical">
              {t("members.atLeastOneRole")}
            </p>
          ) : null}
          {assignableRoles.some((role) => role.code === "employee") ? (
            <div className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-3">
              <p className="text-xs font-semibold text-ink">
                {fr ? "Accès temporairement limité" : "Temporary limited access"}
              </p>
              <p className="mt-1 text-xs leading-5 text-ink-secondary">
                {fr
                  ? "Retire les accès de gestion et conserve uniquement l’espace Employé : tâches personnelles, présence et documents autorisés. Les rôles actuels peuvent être rétablis plus tard."
                  : "Removes management access and keeps only the Employee space: personal tasks, attendance and permitted documents. Current roles can be restored later."}
              </p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="mt-3"
                disabled={roleCodes.length === 1 && roleCodes[0] === "employee"}
                onClick={() => setRoleCodes(["employee"])}
              >
                <ShieldCheck />
                {fr ? "Limiter à l’espace Employé" : "Limit to Employee space"}
              </Button>
              {roleCodes.length === 1 && roleCodes[0] === "employee" ? (
                <p className="mt-2 text-[11px] text-ink-muted">
                  {fr
                    ? "Ce changement sera appliqué après l’enregistrement et la prochaine connexion."
                    : "This change applies after saving and the next sign-in."}
                </p>
              ) : null}
            </div>
          ) : null}
        </fieldset>

        <fieldset>
          <legend className="flex items-center gap-1.5 text-xs font-semibold text-ink">
            <MapPin className="size-3.5" aria-hidden />
            {t("members.provinces")}
          </legend>
          <p className="mt-1 text-xs text-ink-secondary">
            {t("members.provincesHint")}
          </p>

          <div className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1 scrollbar-thin">
            {provinces.length === 0 ? (
              <p className="text-xs text-ink-muted">
                {t("members.noProvincesYet")}
              </p>
            ) : (
              provinces.map((province) => (
                <label
                  key={province.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md p-1.5 hover:bg-surface-1"
                >
                  <input
                    type="checkbox"
                    checked={provinceIds.includes(province.id)}
                    onChange={() =>
                      setProvinceIds((list) => toggle(list, province.id))
                    }
                    className="size-4 accent-[var(--brand)]"
                  />
                  <span className="text-xs font-medium text-ink">
                    {province.name}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {province.code}
                  </span>
                </label>
              ))
            )}
          </div>
        </fieldset>

        {canManageCreationLimits ? (
          <CreationAllowanceEditor
            orgSlug={orgSlug}
            member={member}
            allowances={allowances}
          />
        ) : null}
      </div>

      {failure ? (
        <p className="mt-3 text-xs text-critical" role="alert">
          {failure}
        </p>
      ) : null}

      <div className="mt-4 flex items-center gap-2">
        <Button
          size="sm"
          loading={save.isPending}
          disabled={!dirty || roleCodes.length === 0}
          onClick={() => save.mutate()}
        >
          {t("members.saveAccess")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          {t("members.cancel")}
        </Button>
        {dirty ? (
          <span className="text-xs text-ink-muted">{t("members.unsaved")}</span>
        ) : null}
      </div>
    </div>
  );
}

function locationCode(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "site_")
    .slice(0, 63);
}

export function LocationsControl({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const user = useSessionUser();
  const client = useQueryClient();
  const owner = isOwner(user);
  const canRead = owner && can(user, "sites.read");
  const canCreate = owner && can(user, "sites.create");
  const canUpdate = owner && can(user, "sites.update");
  const canDelete = owner && can(user, "sites.delete");
  const [showProvinceForm, setShowProvinceForm] = useState(false);
  const [showSiteForm, setShowSiteForm] = useState(false);
  const [editingProvince, setEditingProvince] = useState<Province | null>(null);
  const [editingSite, setEditingSite] = useState<OrganizationSite | null>(null);

  const provinces = useQuery({
    queryKey: ["org-provinces", orgSlug],
    queryFn: () =>
      companySetupApi.listProvinces<{ provinces: Province[] }>(orgSlug),
    enabled: canRead,
    select: (data) => data.provinces,
  });
  const sites = useQuery({
    queryKey: ["org-sites", orgSlug],
    queryFn: () =>
      companySetupApi.listSites<{ sites: OrganizationSite[] }>(orgSlug),
    enabled: canRead,
    select: (data) => data.sites,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["org-provinces", orgSlug] });
    void client.invalidateQueries({ queryKey: ["org-sites", orgSlug] });
    void client.invalidateQueries({
      queryKey: ["settings-provinces", orgSlug],
    });
  };
  const deleteProvince = useMutation({
    mutationFn: (province: Province) =>
      companySetupApi.removeProvince(orgSlug, province.id),
    onSuccess: refresh,
  });
  const deleteSite = useMutation({
    mutationFn: (site: OrganizationSite) =>
      companySetupApi.removeSite(orgSlug, site.id),
    onSuccess: refresh,
  });
  const allProvinces = provinces.data ?? [];
  const allSites = sites.data ?? [];

  if (!canRead) return null;
  return (
    <section className="overflow-hidden rounded-2xl border border-border-strong/80 bg-surface-1 shadow-[0_20px_46px_-34px_rgba(15,23,42,.55)]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5 sm:p-6">
        <div>
          <div className="flex items-center gap-2">
            <MapPin className="size-5 text-brand" aria-hidden />
            <h2 className="text-lg font-semibold text-ink">
              {fr ? "Provinces et sites" : "Provinces and sites"}
            </h2>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-secondary">
            {owner
              ? fr
                ? "Créez les provinces puis les fermes, bureaux, entrepôts ou autres sites qui y appartiennent. Ces emplacements alimentent les formulaires opérationnels de LiteHubs."
                : "Create provinces, then the farms, offices, warehouses or other sites that belong to them. These locations feed LiteHubs operational forms."
              : fr
                ? "Voici les emplacements auxquels votre rôle a accès. Seul le Propriétaire peut modifier la structure géographique de l’entreprise."
                : "These are the locations your role can access. Only the Owner can change the company’s geographic structure."}
          </p>
        </div>
        {canCreate ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditingProvince(null);
                setShowProvinceForm((value) => !value);
              }}
            >
              <Plus />
              {fr ? "Ajouter une province" : "Add province"}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setEditingSite(null);
                setShowSiteForm((value) => !value);
              }}
              disabled={!allProvinces.length}
            >
              <Plus />
              {fr ? "Ajouter un site" : "Add site"}
            </Button>
          </div>
        ) : null}
      </div>

      {showProvinceForm || editingProvince ? (
        <ProvinceForm
          key={editingProvince?.id ?? "new-province"}
          orgSlug={orgSlug}
          province={editingProvince}
          fr={fr}
          onDone={() => {
            setShowProvinceForm(false);
            setEditingProvince(null);
            refresh();
          }}
        />
      ) : null}
      {showSiteForm || editingSite ? (
        <SiteForm
          key={editingSite?.id ?? "new-site"}
          orgSlug={orgSlug}
          site={editingSite}
          provinces={allProvinces}
          fr={fr}
          onDone={() => {
            setShowSiteForm(false);
            setEditingSite(null);
            refresh();
          }}
        />
      ) : null}

      {provinces.isPending || sites.isPending ? (
        <SkeletonCard rows={5} />
      ) : null}
      {provinces.isError || sites.isError ? (
        <ErrorState
          description={
            provinces.error instanceof ApiError
              ? provinces.error.message
              : sites.error instanceof ApiError
                ? sites.error.message
                : fr
                  ? "Les emplacements n’ont pas pu être chargés."
                  : "Locations could not be loaded."
          }
          onRetry={() => {
            void provinces.refetch();
            void sites.refetch();
          }}
        />
      ) : null}
      {!provinces.isPending &&
      !sites.isPending &&
      !provinces.isError &&
      !sites.isError ? (
        <div className="grid gap-0 lg:grid-cols-[.82fr_1.18fr]">
          <div className="border-b border-border p-5 lg:border-b-0 lg:border-r sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink">
                  {fr ? "Provinces" : "Provinces"}
                </h3>
                <p className="mt-1 text-xs text-ink-secondary">
                  {allProvinces.length} {fr ? "configurée(s)" : "configured"}
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {allProvinces.length ? (
                allProvinces.map((province) => (
                  <div
                    key={province.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">
                        {province.name}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {province.code}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          province.isActive === false ? "warning" : "good"
                        }
                      >
                        {province.isActive === false
                          ? fr
                            ? "Inactive"
                            : "Inactive"
                          : fr
                            ? "Active"
                            : "Active"}
                      </Badge>
                      {canUpdate ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingProvince(province)}
                        >
                          <Pencil />
                          {fr ? "Modifier" : "Edit"}
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={deleteProvince.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                fr
                                  ? `Retirer la province « ${province.name} » ? Cette action est impossible si elle contient encore des données liées.`
                                  : `Remove province “${province.name}”? This will fail if it still has linked records.`,
                              )
                            )
                              deleteProvince.mutate(province);
                          }}
                        >
                          <Trash2 />
                          {fr ? "Retirer" : "Remove"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState
                  title={fr ? "Aucune province" : "No province yet"}
                  description={
                    fr
                      ? "Ajoutez la première province avant de créer un site."
                      : "Add the first province before creating a site."
                  }
                  icon={MapPin}
                />
              )}
            </div>
            {deleteProvince.error instanceof ApiError ? (
              <p className="mt-3 text-xs text-critical" role="alert">
                {deleteProvince.error.message}
              </p>
            ) : null}
          </div>
          <div className="p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink">
                  {fr ? "Sites opérationnels" : "Operational sites"}
                </h3>
                <p className="mt-1 text-xs text-ink-secondary">
                  {allSites.length}{" "}
                  {fr
                    ? "ferme(s), bureau(x) ou entrepôt(s)"
                    : "farm(s), office(s) or warehouse(s)"}
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {allSites.length ? (
                allSites.map((site) => (
                  <div
                    key={site.id}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border p-3"
                  >
                    <div className="flex min-w-0 gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
                        <Building2 className="size-4" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink">
                          {site.name}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-secondary">
                          {site.province.name} · {site.siteType} · {site.code}
                        </p>
                        {site.address?.city || site.address?.addressLine1 ? (
                          <p className="mt-1 text-xs text-ink-muted">
                            {[site.address?.addressLine1, site.address?.city]
                              .filter(Boolean)
                              .join(", ")}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={site.isActive === false ? "warning" : "good"}
                      >
                        {site.isActive === false
                          ? fr
                            ? "Inactif"
                            : "Inactive"
                          : fr
                            ? "Actif"
                            : "Active"}
                      </Badge>
                      {canUpdate ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingSite(site)}
                        >
                          <Pencil />
                          {fr ? "Modifier" : "Edit"}
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={deleteSite.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                fr
                                  ? `Retirer le site « ${site.name} » ? Cette action est impossible s’il contient encore des données liées.`
                                  : `Remove site “${site.name}”? This will fail if it still has linked records.`,
                              )
                            )
                              deleteSite.mutate(site);
                          }}
                        >
                          <Trash2 />
                          {fr ? "Retirer" : "Remove"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState
                  title={fr ? "Aucun site" : "No site yet"}
                  description={
                    fr
                      ? "Ajoutez une ferme, un bureau ou un entrepôt à une province."
                      : "Add a farm, office or warehouse to a province."
                  }
                  icon={Building2}
                />
              )}
            </div>
            {deleteSite.error instanceof ApiError ? (
              <p className="mt-3 text-xs text-critical" role="alert">
                {deleteSite.error.message}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
function ProvinceForm({
  orgSlug,
  province,
  fr,
  onDone,
}: {
  orgSlug: string;
  province: Province | null;
  fr: boolean;
  onDone: () => void;
}) {
  const [active, setActive] = useState(province?.isActive !== false);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      province
        ? companySetupApi.updateProvince(orgSlug, province.id, body)
        : companySetupApi.createProvince(orgSlug, body),
    onSuccess: onDone,
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const typedCode = String(form.get("code") ?? "").trim();
    const code = typedCode
      ? locationCode(typedCode)
      : (province?.code ?? locationCode(name));
    save.mutate({ name, code, ...(province ? { isActive: active } : {}) });
  };
  const message =
    save.error instanceof ApiError
      ? save.error.fieldErrors.code?.[0] ||
        (save.error.code === "CONFLICT"
          ? fr
            ? "Ce code province est déjà utilisé. Modifiez le code ou conservez le code actuel."
            : "This province code is already used. Change the code or keep the current one."
          : save.error.message)
      : save.error
        ? fr
          ? "La province n’a pas pu être enregistrée."
          : "The province could not be saved."
        : null;
  return (
    <form
      className="border-b border-brand/20 bg-brand/5 p-5 sm:p-6"
      onSubmit={submit}
      noValidate
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink">
            {province
              ? fr
                ? "Modifier la province"
                : "Edit province"
              : fr
                ? "Ajouter une province"
                : "Add province"}
          </h3>
          <p className="mt-1 text-xs leading-5 text-ink-secondary">
            {fr
              ? "Le code est utilisé en interne et reste unique dans l’entreprise."
              : "The code is used internally and remains unique within the company."}
          </p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {fr ? "Annuler" : "Cancel"}
        </Button>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field
          label={fr ? "Nom de la province" : "Province name"}
          htmlFor="settings-province-name"
          required
        >
          <Input
            id="settings-province-name"
            name="name"
            required
            autoFocus
            defaultValue={province?.name ?? ""}
          />
        </Field>
        <Field
          label={fr ? "Code province" : "Province code"}
          htmlFor="settings-province-code"
          hint={
            fr
              ? "Généré depuis le nom si vide."
              : "Generated from the name when left blank."
          }
        >
          <Input
            id="settings-province-code"
            name="code"
            defaultValue={province?.code ?? ""}
          />
        </Field>
        {province ? (
          <label className="flex items-center gap-2 text-sm font-medium text-ink sm:col-span-2">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
              className="size-4 accent-[var(--brand)]"
            />
            {fr ? "Province active" : "Province active"}
          </label>
        ) : null}
      </div>
      {message ? (
        <p className="mt-3 text-xs text-critical" role="alert">
          {message}
        </p>
      ) : null}
      <div className="mt-4 flex justify-end">
        <Button type="submit" loading={save.isPending}>
          <CheckCircle2 />
          {province
            ? fr
              ? "Enregistrer les modifications"
              : "Save changes"
            : fr
              ? "Créer la province"
              : "Create province"}
        </Button>
      </div>
    </form>
  );
}
function SiteForm({
  orgSlug,
  site,
  provinces,
  fr,
  onDone,
}: {
  orgSlug: string;
  site: OrganizationSite | null;
  provinces: Province[];
  fr: boolean;
  onDone: () => void;
}) {
  const [active, setActive] = useState(site?.isActive !== false);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      site
        ? companySetupApi.updateSite(orgSlug, site.id, body)
        : companySetupApi.createSite(orgSlug, body),
    onSuccess: onDone,
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const typedCode = String(form.get("code") ?? "").trim();
    const optional = (key: string) =>
      String(form.get(key) ?? "").trim() || undefined;
    save.mutate({
      provinceId: String(form.get("provinceId") ?? ""),
      name,
      code: locationCode(typedCode || name),
      siteType: String(form.get("siteType") ?? "farm"),
      addressLine1: optional("addressLine1"),
      addressLine2: optional("addressLine2"),
      city: optional("city"),
      postalCode: optional("postalCode"),
      ...(site ? { isActive: active } : {}),
    });
  };
  const message =
    save.error instanceof ApiError
      ? save.error.fieldErrors.code?.[0] ||
        (save.error.code === "CONFLICT"
          ? fr
            ? "Ce code province est déjà utilisé. Modifiez le code ou conservez le code actuel."
            : "This province code is already used. Change the code or keep the current one."
          : save.error.message)
      : save.error
        ? fr
          ? "Le site n’a pas pu être enregistré."
          : "The site could not be saved."
        : null;
  return (
    <form
      className="border-b border-brand/20 bg-brand/5 p-5 sm:p-6"
      onSubmit={submit}
      noValidate
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink">
            {site
              ? fr
                ? "Modifier le site"
                : "Edit site"
              : fr
                ? "Ajouter un site"
                : "Add site"}
          </h3>
          <p className="mt-1 text-xs leading-5 text-ink-secondary">
            {fr
              ? "Un site peut être une ferme, un bureau, un entrepôt ou un autre emplacement opérationnel."
              : "A site can be a farm, office, warehouse or another operational location."}
          </p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {fr ? "Annuler" : "Cancel"}
        </Button>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label={fr ? "Nom du site" : "Site name"}
          htmlFor="settings-site-name"
          required
        >
          <Input
            id="settings-site-name"
            name="name"
            required
            autoFocus
            defaultValue={site?.name ?? ""}
          />
        </Field>
        <Field
          label={fr ? "Code site" : "Site code"}
          htmlFor="settings-site-code"
          hint={
            fr
              ? "Généré depuis le nom si vide."
              : "Generated from the name when left blank."
          }
        >
          <Input
            id="settings-site-code"
            name="code"
            defaultValue={site?.code ?? ""}
          />
        </Field>
        <Field
          label={fr ? "Province" : "Province"}
          htmlFor="settings-site-province"
          required
        >
          <select
            id="settings-site-province"
            name="provinceId"
            required
            defaultValue={site?.province.id ?? ""}
            className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
          >
            <option value="">
              {fr ? "Choisir une province" : "Choose a province"}
            </option>
            {provinces
              .filter(
                (province) =>
                  province.isActive !== false ||
                  province.id === site?.province.id,
              )
              .map((province) => (
                <option key={province.id} value={province.id}>
                  {province.name}
                </option>
              ))}
          </select>
        </Field>
        <Field
          label={fr ? "Type de site" : "Site type"}
          htmlFor="settings-site-type"
          required
        >
          <select
            id="settings-site-type"
            name="siteType"
            defaultValue={site?.siteType ?? "farm"}
            className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
          >
            <option value="farm">{fr ? "Ferme" : "Farm"}</option>
            <option value="office">{fr ? "Bureau" : "Office"}</option>
            <option value="warehouse">{fr ? "Entrepôt" : "Warehouse"}</option>
            <option value="other">{fr ? "Autre" : "Other"}</option>
          </select>
        </Field>
        <Field
          label={fr ? "Adresse" : "Address"}
          htmlFor="settings-site-address"
        >
          <Input
            id="settings-site-address"
            name="addressLine1"
            defaultValue={site?.address?.addressLine1 ?? ""}
          />
        </Field>
        <Field label={fr ? "Ville" : "City"} htmlFor="settings-site-city">
          <Input
            id="settings-site-city"
            name="city"
            defaultValue={site?.address?.city ?? ""}
          />
        </Field>
        <Field
          label={fr ? "Complément d’adresse" : "Address line 2"}
          htmlFor="settings-site-address-two"
        >
          <Input
            id="settings-site-address-two"
            name="addressLine2"
            defaultValue={site?.address?.addressLine2 ?? ""}
          />
        </Field>
        <Field
          label={fr ? "Code postal" : "Postal code"}
          htmlFor="settings-site-postal"
        >
          <Input
            id="settings-site-postal"
            name="postalCode"
            defaultValue={site?.address?.postalCode ?? ""}
          />
        </Field>
        {site ? (
          <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium text-ink">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
              className="size-4 accent-[var(--brand)]"
            />
            {fr ? "Site actif" : "Site active"}
          </label>
        ) : null}
      </div>
      {message ? (
        <p className="mt-3 text-xs text-critical" role="alert">
          {message}
        </p>
      ) : null}
      <div className="mt-4 flex justify-end">
        <Button
          type="submit"
          loading={save.isPending}
          disabled={!provinces.length}
        >
          <CheckCircle2 />
          {site
            ? fr
              ? "Enregistrer les modifications"
              : "Save changes"
            : fr
              ? "Créer le site"
              : "Create site"}
        </Button>
      </div>
    </form>
  );
}
