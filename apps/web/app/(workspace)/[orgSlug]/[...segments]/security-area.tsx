"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CarFront,
  CheckCircle2,
  KeyRound,
  LogIn,
  LogOut,
  Plus,
  ShieldCheck,
  UserRoundCheck,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { ApiError, get, orgUrl } from "@/lib/api";
import {
  companySetupApi,
  type OrganizationSite,
} from "@/lib/company-setup-api";
import {
  ownerManagementApi,
  type OwnerManagementResource,
} from "@/lib/owner-management-api";
import { can } from "@/lib/permissions";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";

type Row = Record<string, unknown> & { id: string };
type Employee = {
  id: string;
  fullName: string;
  employeeNumber?: string | null;
};
const copy = (fr: boolean, en: string, french: string) => (fr ? french : en);
const text = (item: unknown) => String(item ?? "").trim();
const label = (item: unknown) =>
  text(item)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "—";
const dateTime = (item: unknown, locale: string) =>
  item
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(String(item)))
    : "—";
const local = (item: unknown) =>
  item ? new Date(String(item)).toISOString().slice(0, 16) : "";
const iso = (item: FormDataEntryValue | null) =>
  text(item) ? new Date(text(item)).toISOString() : undefined;
const optional = (item: FormDataEntryValue | null) => text(item) || undefined;
const numeric = (item: FormDataEntryValue | null) =>
  text(item) === "" ? null : Number(text(item));
function Select({
  name,
  value,
  onChange,
  children,
  required = false,
}: {
  name: string;
  value: string;
  onChange?: (next: string) => void;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <select
      name={name}
      value={onChange ? value : undefined}
      defaultValue={onChange ? undefined : value}
      onChange={(event) => onChange?.(event.target.value)}
      required={required}
      className="h-10 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
    >
      {children}
    </select>
  );
}
function useRows(
  orgSlug: string,
  resource: OwnerManagementResource,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["security", orgSlug, resource],
    queryFn: () =>
      ownerManagementApi.list<{ records: Row[] }>(orgSlug, resource),
    enabled,
    select: (data) => data.records,
  });
}

export function SecurityArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const user = useSessionUser();
  const [tab, setTab] = useState<"visitors" | "gate" | "keys" | "handovers">(
    "visitors",
  );
  const [editor, setEditor] = useState<{
    resource: OwnerManagementResource;
    row: Row | "new";
  } | null>(null);
  const visitors = useRows(
    orgSlug,
    "security-visitors",
    can(user, "security.read"),
  );
  const movements = useRows(
    orgSlug,
    "security-asset-movements",
    can(user, "security.read"),
  );
  const keys = useRows(orgSlug, "security-keys", can(user, "security.read"));
  const handovers = useRows(
    orgSlug,
    "security-key-handovers",
    can(user, "security.read"),
  );
  const sites = useQuery({
    queryKey: ["org-sites", orgSlug],
    queryFn: () =>
      companySetupApi.listSites<{ sites: OrganizationSite[] }>(orgSlug),
    select: (data) => data.sites,
  });
  const employees = useQuery({
    queryKey: ["employees", orgSlug],
    queryFn: () => get<{ employees: Employee[] }>(orgUrl(orgSlug, "employees")),
    enabled: can(user, "employees.read"),
    select: (data) => data.employees,
  });
  const assets = useRows(orgSlug, "assets", can(user, "equipment.read"));
  const metrics = useMemo(
    () => ({
      onSite: (visitors.data ?? []).filter((row) => !row.exitedAt).length,
      openReturns: (movements.data ?? []).filter(
        (row) => row.direction === "out" && !row.returnedAt,
      ).length,
      keysOut: (handovers.data ?? []).filter((row) => !row.returnedAt).length,
      activeKeys: (keys.data ?? []).filter((row) => row.isActive !== false)
        .length,
    }),
    [visitors.data, movements.data, handovers.data, keys.data],
  );
  const current =
    tab === "visitors"
      ? visitors
      : tab === "gate"
        ? movements
        : tab === "keys"
          ? keys
          : handovers;
  if (current.isPending)
    return (
      <main className="p-6">
        <Skeleton className="h-96" />
      </main>
    );
  if (current.isError)
    return (
      <ErrorState
        description={(current.error as ApiError).message}
        onRetry={() => void current.refetch()}
      />
    );
  const tabs = [
    {
      id: "visitors" as const,
      label: copy(fr, "Visitors", "Visiteurs"),
      icon: UserRoundCheck,
      count: visitors.data?.length ?? 0,
      resource: "security-visitors" as const,
    },
    {
      id: "gate" as const,
      label: copy(fr, "Gate movements", "Mouvements portail"),
      icon: CarFront,
      count: movements.data?.length ?? 0,
      resource: "security-asset-movements" as const,
    },
    {
      id: "keys" as const,
      label: copy(fr, "Key register", "Registre des clefs"),
      icon: KeyRound,
      count: keys.data?.length ?? 0,
      resource: "security-keys" as const,
    },
    {
      id: "handovers" as const,
      label: copy(fr, "Key handovers", "Remises de clefs"),
      icon: ShieldCheck,
      count: handovers.data?.length ?? 0,
      resource: "security-key-handovers" as const,
    },
  ];
  const rows = current.data ?? [];
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <header className="overflow-hidden rounded-3xl border border-border bg-[linear-gradient(120deg,#0f172a,#164e63_56%,#0f766e)] p-6 text-white shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
              <ShieldCheck className="size-3.5" />
              {copy(fr, "Controlled site access", "Accès aux sites contrôlé")}
            </span>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight">
              {copy(fr, "Security", "Sécurité")}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-cyan-50">
              {copy(
                fr,
                "Know who is on site, what leaves the gate, and where every controlled key is held.",
                "Sachez qui est sur site, ce qui franchit le portail et qui détient chaque clef contrôlée.",
              )}
            </p>
          </div>
          {can(user, "security.create") ? (
            <Button
              className="bg-white text-cyan-900 hover:bg-cyan-50"
              onClick={() =>
                setEditor({
                  resource: tabs.find((item) => item.id === tab)!.resource,
                  row: "new",
                })
              }
            >
              <Plus />
              {copy(fr, "New register entry", "Nouvelle saisie")}
            </Button>
          ) : null}
        </div>
      </header>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["On site", metrics.onSite, "Personnes sur site"],
          ["Open returns", metrics.openReturns, "Retours attendus"],
          ["Keys out", metrics.keysOut, "Clefs sorties"],
          ["Active keys", metrics.activeKeys, "Clefs actives"],
        ].map(([en, count, french]) => (
          <div
            key={String(en)}
            className="rounded-2xl border border-border bg-surface-1 p-4 shadow-sm"
          >
            <p className="text-xs font-semibold text-ink-muted">
              {copy(fr, String(en), String(french))}
            </p>
            <p className="mt-2 text-3xl font-semibold text-ink">{count}</p>
          </div>
        ))}
      </section>
      <section className="rounded-2xl border border-border bg-surface-1 shadow-sm">
        <nav
          className="flex overflow-x-auto border-b border-border px-3"
          aria-label={copy(fr, "Security areas", "Zones de sécurité")}
        >
          {tabs.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setTab(item.id);
                  setEditor(null);
                }}
                className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold ${tab === item.id ? "border-brand text-brand" : "border-transparent text-ink-muted hover:text-ink"}`}
              >
                <Icon className="size-4" />
                {item.label}
                <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] text-ink-secondary">
                  {item.count}
                </span>
              </button>
            );
          })}
        </nav>
        <div className="grid gap-5 p-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <section>
            {rows.length ? (
              <div className="space-y-3">
                {rows.map((row) => (
                  <SecurityCard
                    key={row.id}
                    row={row}
                    tab={tab}
                    sites={sites.data ?? []}
                    locale={locale}
                    editable={can(user, "security.update")}
                    onEdit={() =>
                      setEditor({
                        resource: tabs.find((item) => item.id === tab)!
                          .resource,
                        row,
                      })
                    }
                    onAction={(body) =>
                      ownerManagementApi
                        .update(
                          orgSlug,
                          tabs.find((item) => item.id === tab)!.resource,
                          row.id,
                          body,
                        )
                        .then(() => {
                          void current.refetch();
                        })
                    }
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={tabs.find((item) => item.id === tab)!.icon}
                title={copy(
                  fr,
                  "No entries yet",
                  "Aucune saisie pour le moment",
                )}
                description={copy(
                  fr,
                  "Create the first controlled record for this area.",
                  "Créez le premier enregistrement contrôlé pour cette zone.",
                )}
              />
            )}
          </section>
          <aside className="xl:sticky xl:top-6 xl:self-start">
            {editor ? (
              <SecurityEditor
                orgSlug={orgSlug}
                resource={editor.resource}
                row={editor.row}
                sites={sites.data ?? []}
                employees={employees.data ?? []}
                assets={assets.data ?? []}
                keys={keys.data ?? []}
                onClose={() => setEditor(null)}
              />
            ) : (
              <SecurityGuide fr={fr} tab={tab} />
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}
function SecurityCard({
  row,
  tab,
  sites,
  locale,
  editable,
  onEdit,
  onAction,
}: {
  row: Row;
  tab: string;
  sites: OrganizationSite[];
  locale: string;
  editable: boolean;
  onEdit: () => void;
  onAction: (body: Record<string, unknown>) => void;
}) {
  const { locale: currentLocale } = useLanguage();
  const fr = currentLocale === "fr";
  const site = sites.find((item) => item.id === row.siteId);
  const open =
    tab === "visitors"
      ? !row.exitedAt
      : tab === "gate"
        ? row.direction === "out" && !row.returnedAt
        : tab === "handovers"
          ? !row.returnedAt
          : false;
  const titleText =
    tab === "visitors"
      ? String(row.visitorName)
      : tab === "gate"
        ? String(row.description)
        : tab === "keys"
          ? String(row.name)
          : String(row.keyName ?? row.holderName ?? row.employeeName ?? "—");
  const detail =
    tab === "visitors"
      ? [row.organizationName, row.purpose, row.vehiclePlate]
          .filter(Boolean)
          .join(" · ")
      : tab === "gate"
        ? [label(row.direction), row.assetName, row.gatePassNumber]
            .filter(Boolean)
            .join(" · ")
        : tab === "keys"
          ? [
              row.code,
              row.locationDetail,
              `${row.copiesTotal ?? 1} ${copy(fr, "copies", "copies")}`,
            ]
              .filter(Boolean)
              .join(" · ")
          : [row.keyCode, row.keyName, row.employeeName ?? row.holderName]
              .filter(Boolean)
              .join(" · ");
  return (
    <article className="rounded-2xl border border-border bg-surface-1 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-ink">{titleText}</p>
            {open ? (
              <Badge variant="warning" icon={false}>
                {copy(fr, "Open", "Ouvert")}
              </Badge>
            ) : (
              <Badge variant="good" icon={false}>
                {tab === "keys"
                  ? row.isActive === false
                    ? copy(fr, "Inactive", "Inactif")
                    : copy(fr, "Active", "Actif")
                  : copy(fr, "Closed", "Clôturé")}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-ink-secondary">{detail || "—"}</p>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-muted">
            <span>{site?.name ?? String(row.siteName ?? "—")}</span>
            <span>
              {dateTime(row.enteredAt ?? row.movedAt ?? row.issuedAt, locale)}
            </span>
            {tab === "visitors" && row.disinfected ? (
              <span className="font-medium text-good-ink">
                {copy(fr, "Disinfected", "Désinfecté")}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex gap-2">
          {editable && open && tab !== "keys" ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                onAction(
                  tab === "visitors"
                    ? { exitedAt: new Date().toISOString() }
                    : tab === "gate"
                      ? { returnedAt: new Date().toISOString() }
                      : { returnedAt: new Date().toISOString() },
                )
              }
            >
              {tab === "visitors" ? <LogOut /> : <CheckCircle2 />}
              {copy(fr, "Close", "Clôturer")}
            </Button>
          ) : null}
          {editable ? (
            <Button size="sm" variant="secondary" onClick={onEdit}>
              {copy(fr, "Edit", "Modifier")}
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
function SecurityGuide({ fr, tab }: { fr: boolean; tab: string }) {
  const content =
    tab === "visitors"
      ? copy(
          fr,
          "A visitor remains on site until their exit is recorded. Mark disinfection when biosecurity screening was completed.",
          "Un visiteur reste sur site jusqu’à l’enregistrement de sa sortie. Marquez la désinfection lorsque le contrôle de biosécurité est terminé.",
        )
      : tab === "gate"
        ? copy(
            fr,
            "A movement leaving the gate stays open until its return is confirmed. Use the gate-pass number for traceability.",
            "Un mouvement sortant reste ouvert jusqu’à confirmation du retour. Utilisez le numéro de laissez-passer pour la traçabilité.",
          )
        : tab === "keys"
          ? copy(
              fr,
              "Every controlled key has one code, a location and a known number of copies.",
              "Chaque clef contrôlée possède un code, un emplacement et un nombre de copies connu.",
            )
          : copy(
              fr,
              "Record who holds a key and confirm its return to keep the register accurate.",
              "Enregistrez qui détient une clef et confirmez son retour pour maintenir le registre exact.",
            );
  return (
    <section className="rounded-2xl border border-dashed border-border bg-surface-2 p-5">
      <ShieldCheck className="size-6 text-brand" />
      <h2 className="mt-4 font-semibold text-ink">
        {copy(fr, "Control note", "Note de contrôle")}
      </h2>
      <p className="mt-2 text-sm leading-6 text-ink-secondary">{content}</p>
    </section>
  );
}
function SecurityEditor({
  orgSlug,
  resource,
  row,
  sites,
  employees,
  assets,
  keys,
  onClose,
}: {
  orgSlug: string;
  resource: OwnerManagementResource;
  row: Row | "new";
  sites: OrganizationSite[];
  employees: Employee[];
  assets: Row[];
  keys: Row[];
  onClose: () => void;
}) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const queryClient = useQueryClient();
  const current = row === "new" ? null : row;
  const isNew = row === "new";
  const [siteId, setSiteId] = useState(text(current?.siteId));
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      isNew
        ? ownerManagementApi.create<{ record: Row }>(orgSlug, resource, body)
        : ownerManagementApi.update<{ record: Row }>(
            orgSlug,
            resource,
            current!.id,
            body,
          ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["security", orgSlug, resource],
      });
      onClose();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selectedSite = sites.find((site) => site.id === siteId);
    const provinceId = selectedSite?.province.id ?? null;
    const base = { notes: optional(form.get("notes")) };
    let body: Record<string, unknown> = { ...base };
    if (resource === "security-visitors")
      body = {
        ...body,
        provinceId,
        siteId,
        visitorName: text(form.get("visitorName")),
        organizationName: optional(form.get("organizationName")),
        phone: optional(form.get("phone")),
        idNumber: optional(form.get("idNumber")),
        purpose: text(form.get("purpose")),
        hostEmployeeId: optional(form.get("hostEmployeeId")),
        vehiclePlate: optional(form.get("vehiclePlate")),
        enteredAt: iso(form.get("enteredAt")),
        exitedAt: iso(form.get("exitedAt")),
        lastFarmVisitDays: numeric(form.get("lastFarmVisitDays")),
        disinfected: form.get("disinfected") === "on",
      };
    if (resource === "security-asset-movements")
      body = {
        ...body,
        provinceId,
        siteId,
        direction: text(form.get("direction")),
        assetId: optional(form.get("assetId")),
        description: text(form.get("description")),
        quantity: numeric(form.get("quantity")),
        unit: optional(form.get("unit")),
        carriedBy: optional(form.get("carriedBy")),
        vehiclePlate: optional(form.get("vehiclePlate")),
        gatePassNumber: optional(form.get("gatePassNumber")),
        movedAt: iso(form.get("movedAt")),
        expectedReturnAt: iso(form.get("expectedReturnAt")),
        returnedAt: iso(form.get("returnedAt")),
      };
    if (resource === "security-keys")
      body = {
        ...body,
        siteId,
        code: text(form.get("code")),
        name: text(form.get("name")),
        locationDetail: optional(form.get("locationDetail")),
        copiesTotal: numeric(form.get("copiesTotal")),
        isActive: form.get("isActive") === "on",
      };
    if (resource === "security-key-handovers")
      body = {
        ...body,
        keyId: text(form.get("keyId")),
        employeeId: optional(form.get("employeeId")),
        holderName: optional(form.get("holderName")),
        issuedAt: iso(form.get("issuedAt")),
        returnedAt: iso(form.get("returnedAt")),
      };
    save.mutate(body);
  };
  const failure =
    save.error instanceof ApiError
      ? save.error.message
      : save.error
        ? copy(
            fr,
            "Could not save this record.",
            "Impossible d’enregistrer ce dossier.",
          )
        : null;
  const heading =
    resource === "security-visitors"
      ? copy(fr, "Visitor entry", "Entrée visiteur")
      : resource === "security-asset-movements"
        ? copy(fr, "Gate movement", "Mouvement portail")
        : resource === "security-keys"
          ? copy(fr, "Controlled key", "Clef contrôlée")
          : copy(fr, "Key handover", "Remise de clef");
  return (
    <section className="rounded-2xl border border-border bg-surface-1 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-ink">
            {isNew ? copy(fr, "Add", "Ajouter") : copy(fr, "Edit", "Modifier")}{" "}
            · {heading}
          </h2>
          <p className="mt-1 text-xs text-ink-secondary">
            {copy(
              fr,
              "Only people with Security permission can change this controlled register.",
              "Seules les personnes ayant la permission Sécurité peuvent modifier ce registre contrôlé.",
            )}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          <X />
        </Button>
      </div>
      <form className="mt-5 grid gap-3" onSubmit={submit}>
        {resource !== "security-key-handovers" ? (
          <Field label={copy(fr, "Site / farm", "Site / ferme")} required>
            <Select name="siteId" value={siteId} onChange={setSiteId} required>
              <option value="">
                {copy(fr, "Select site", "Choisir un site")}
              </option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {resource === "security-visitors" ? (
          <>
            <Field label={copy(fr, "Visitor name", "Nom du visiteur")} required>
              <Input
                name="visitorName"
                required
                defaultValue={text(current?.visitorName)}
              />
            </Field>
            <Field label={copy(fr, "Organization", "Organisation")}>
              <Input
                name="organizationName"
                defaultValue={text(current?.organizationName)}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={copy(fr, "Purpose", "Objet de la visite")} required>
                <Input
                  name="purpose"
                  required
                  defaultValue={text(current?.purpose)}
                />
              </Field>
              <Field label={copy(fr, "Phone", "Téléphone")}>
                <Input name="phone" defaultValue={text(current?.phone)} />
              </Field>
            </div>
            <Field label={copy(fr, "Host employee", "Employé hôte")}>
              <Select
                name="hostEmployeeId"
                value={text(current?.hostEmployeeId)}
              >
                <option value="">
                  {copy(fr, "No host selected", "Aucun hôte sélectionné")}
                </option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.employeeNumber
                      ? `${employee.employeeNumber} · `
                      : ""}
                    {employee.fullName}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={copy(fr, "Vehicle plate", "Plaque véhicule")}>
                <Input
                  name="vehiclePlate"
                  defaultValue={text(current?.vehiclePlate)}
                />
              </Field>
              <Field
                label={copy(
                  fr,
                  "Previous farm visit (days)",
                  "Dernière ferme visitée (jours)",
                )}
              >
                <Input
                  name="lastFarmVisitDays"
                  type="number"
                  min="0"
                  defaultValue={text(current?.lastFarmVisitDays)}
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={copy(fr, "Entry", "Entrée")}>
                <Input
                  name="enteredAt"
                  type="datetime-local"
                  defaultValue={
                    local(current?.enteredAt) ||
                    new Date().toISOString().slice(0, 16)
                  }
                />
              </Field>
              <Field label={copy(fr, "Exit", "Sortie")}>
                <Input
                  name="exitedAt"
                  type="datetime-local"
                  defaultValue={local(current?.exitedAt)}
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                name="disinfected"
                type="checkbox"
                defaultChecked={current?.disinfected === true}
                className="size-4 accent-[var(--brand)]"
              />
              {copy(
                fr,
                "Biosecurity disinfection completed",
                "Désinfection de biosécurité effectuée",
              )}
            </label>
          </>
        ) : null}
        {resource === "security-asset-movements" ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={copy(fr, "Direction", "Sens")} required>
                <Select
                  name="direction"
                  value={text(current?.direction) || "out"}
                  required
                >
                  <option value="out">{copy(fr, "Out", "Sortie")}</option>
                  <option value="in">{copy(fr, "In", "Entrée")}</option>
                </Select>
              </Field>
              <Field
                label={copy(fr, "Gate-pass number", "Numéro de laissez-passer")}
              >
                <Input
                  name="gatePassNumber"
                  defaultValue={text(current?.gatePassNumber)}
                />
              </Field>
            </div>
            <Field
              label={copy(fr, "Asset (optional)", "Équipement (facultatif)")}
            >
              <Select name="assetId" value={text(current?.assetId)}>
                <option value="">
                  {copy(
                    fr,
                    "Other item / no tracked asset",
                    "Autre élément / aucun actif suivi",
                  )}
                </option>
                {assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {String(asset.name ?? asset.assetNumber ?? asset.id)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={copy(fr, "Description", "Description")} required>
              <Textarea
                name="description"
                required
                rows={3}
                defaultValue={text(current?.description)}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={copy(fr, "Quantity", "Quantité")}>
                <Input
                  name="quantity"
                  type="number"
                  min="0"
                  step="0.001"
                  defaultValue={text(current?.quantity)}
                />
              </Field>
              <Field label={copy(fr, "Unit", "Unité")}>
                <Input name="unit" defaultValue={text(current?.unit)} />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={copy(fr, "Movement time", "Heure du mouvement")}>
                <Input
                  name="movedAt"
                  type="datetime-local"
                  defaultValue={
                    local(current?.movedAt) ||
                    new Date().toISOString().slice(0, 16)
                  }
                />
              </Field>
              <Field label={copy(fr, "Expected return", "Retour attendu")}>
                <Input
                  name="expectedReturnAt"
                  type="datetime-local"
                  defaultValue={local(current?.expectedReturnAt)}
                />
              </Field>
            </div>
            <Field label={copy(fr, "Confirmed return", "Retour confirmé")}>
              <Input
                name="returnedAt"
                type="datetime-local"
                defaultValue={local(current?.returnedAt)}
              />
            </Field>
            <Field label={copy(fr, "Carried by", "Transporté par")}>
              <Input name="carriedBy" defaultValue={text(current?.carriedBy)} />
            </Field>
          </>
        ) : null}
        {resource === "security-keys" ? (
          <>
            <Field label={copy(fr, "Key name", "Nom de la clef")} required>
              <Input name="name" required defaultValue={text(current?.name)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={copy(fr, "Key code", "Code clef")} required>
                <Input
                  name="code"
                  required
                  defaultValue={text(current?.code)}
                  placeholder="KEY-001"
                />
              </Field>
              <Field label={copy(fr, "Copies total", "Nombre de copies")}>
                <Input
                  name="copiesTotal"
                  type="number"
                  min="1"
                  defaultValue={text(current?.copiesTotal) || "1"}
                />
              </Field>
            </div>
            <Field label={copy(fr, "What it opens", "Ce qu’elle ouvre")}>
              <Input
                name="locationDetail"
                defaultValue={text(current?.locationDetail)}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                name="isActive"
                type="checkbox"
                defaultChecked={current?.isActive !== false}
                className="size-4 accent-[var(--brand)]"
              />
              {copy(fr, "Key is active", "Clef active")}
            </label>
          </>
        ) : null}
        {resource === "security-key-handovers" ? (
          <>
            <Field
              label={copy(fr, "Controlled key", "Clef contrôlée")}
              required
            >
              <Select name="keyId" value={text(current?.keyId)} required>
                <option value="">
                  {copy(fr, "Select key", "Choisir une clef")}
                </option>
                {keys
                  .filter((key) => key.isActive !== false)
                  .map((key) => (
                    <option key={key.id} value={key.id}>
                      {String(key.code)} · {String(key.name)}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label={copy(fr, "Employee holder", "Employé détenteur")}>
              <Select name="employeeId" value={text(current?.employeeId)}>
                <option value="">
                  {copy(
                    fr,
                    "External / named holder",
                    "Détenteur externe / nommé",
                  )}
                </option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.employeeNumber
                      ? `${employee.employeeNumber} · `
                      : ""}
                    {employee.fullName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={copy(
                fr,
                "Holder name if not employee",
                "Nom du détenteur si non employé",
              )}
            >
              <Input
                name="holderName"
                defaultValue={text(current?.holderName)}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={copy(fr, "Issued", "Remise")}>
                <Input
                  name="issuedAt"
                  type="datetime-local"
                  defaultValue={
                    local(current?.issuedAt) ||
                    new Date().toISOString().slice(0, 16)
                  }
                />
              </Field>
              <Field label={copy(fr, "Returned", "Retour")}>
                <Input
                  name="returnedAt"
                  type="datetime-local"
                  defaultValue={local(current?.returnedAt)}
                />
              </Field>
            </div>
          </>
        ) : null}
        <Field label={copy(fr, "Notes", "Notes")}>
          <Textarea name="notes" rows={2} defaultValue={text(current?.notes)} />
        </Field>
        {failure ? (
          <p className="text-xs text-critical" role="alert">
            {failure}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            {copy(fr, "Cancel", "Annuler")}
          </Button>
          <Button type="submit" loading={save.isPending}>
            <CheckCircle2 />
            {copy(fr, "Save", "Enregistrer")}
          </Button>
        </div>
      </form>
    </section>
  );
}
