"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPlus,
  Clock3,
  MapPin,
  Pencil,
  Plus,
  ShieldAlert,
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
  type Province,
} from "@/lib/company-setup-api";
import { ownerManagementApi } from "@/lib/owner-management-api";
import { can } from "@/lib/permissions";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";

type Row = Record<string, unknown> & { id: string };
type Employee = {
  id: string;
  fullName: string;
  employeeNumber?: string | null;
  province?: { id: string; name: string } | null;
  site?: { id: string; name: string } | null;
};
const copy = (fr: boolean, en: string, french: string) => (fr ? french : en);
const value = (item: unknown) => String(item ?? "").trim();
const title = (item: unknown) =>
  value(item)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "—";
const dayTime = (item: unknown, locale: string) =>
  item
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(String(item)))
    : "—";
const severityTone = (severity: unknown) =>
  ["critical", "fatal"].includes(value(severity))
    ? ("serious" as const)
    : ["serious"].includes(value(severity))
      ? ("warning" as const)
      : ("outline" as const);
const statusTone = (status: unknown) =>
  value(status) === "closed"
    ? ("good" as const)
    : value(status) === "investigating"
      ? ("info" as const)
      : ("warning" as const);
const localDateTime = (input: unknown) =>
  input ? new Date(String(input)).toISOString().slice(0, 16) : "";
const iso = (input: FormDataEntryValue | null) => {
  const raw = value(input);
  return raw ? new Date(raw).toISOString() : undefined;
};
const blank = (input: FormDataEntryValue | null) => value(input) || undefined;
const numberOrNull = (input: FormDataEntryValue | null) => {
  const raw = value(input);
  return raw === "" ? null : Number(raw);
};
function Select({
  name,
  value: selected,
  onChange,
  children,
  required = false,
}: {
  name: string;
  value: string;
  onChange?: (value: string) => void;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <select
      name={name}
      value={onChange ? selected : undefined}
      defaultValue={onChange ? undefined : selected}
      required={required}
      onChange={(event) => onChange?.(event.target.value)}
      className="h-10 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
    >
      {children}
    </select>
  );
}

export function IncidentsArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const user = useSessionUser();
  const [status, setStatus] = useState("all");
  const [editor, setEditor] = useState<Row | "new" | null>(null);
  const incidents = useQuery({
    queryKey: ["incidents", orgSlug],
    queryFn: () =>
      ownerManagementApi.list<{ records: Row[] }>(orgSlug, "incidents"),
    select: (data) => data.records,
  });
  const provinces = useQuery({
    queryKey: ["org-provinces", orgSlug],
    queryFn: () =>
      companySetupApi.listProvinces<{ provinces: Province[] }>(orgSlug),
    select: (data) => data.provinces,
  });
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
  const rows = useMemo(
    () =>
      (incidents.data ?? []).filter(
        (item) => status === "all" || item.status === status,
      ),
    [incidents.data, status],
  );
  const metrics = useMemo(() => {
    const all = incidents.data ?? [];
    return {
      open: all.filter((item) => item.status !== "closed").length,
      investigating: all.filter((item) => item.status === "investigating")
        .length,
      critical: all.filter((item) =>
        ["critical", "fatal"].includes(value(item.severity)),
      ).length,
      actions: all.filter((item) => item.status === "action_required").length,
    };
  }, [incidents.data]);
  if (incidents.isPending)
    return (
      <main className="p-6">
        <Skeleton className="h-96" />
      </main>
    );
  if (incidents.isError)
    return (
      <ErrorState
        description={(incidents.error as ApiError).message}
        onRetry={() => void incidents.refetch()}
      />
    );
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <header className="overflow-hidden rounded-3xl border border-border bg-[linear-gradient(120deg,#7f1d1d,#b91c1c_54%,#ef4444)] p-6 text-white shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
              <ShieldAlert className="size-3.5" />
              {copy(
                fr,
                "Safety & incident control",
                "Sécurité et maîtrise des incidents",
              )}
            </span>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight">
              {copy(fr, "Incidents", "Incidents")}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-red-50">
              {copy(
                fr,
                "Record facts, assign an investigation, act quickly and keep an auditable close-out record.",
                "Consignez les faits, attribuez l’enquête, agissez rapidement et conservez une clôture traçable.",
              )}
            </p>
          </div>
          {can(user, "incidents.create") ? (
            <Button
              className="bg-white text-red-800 hover:bg-red-50"
              onClick={() => setEditor("new")}
            >
              <Plus />
              {copy(fr, "Report incident", "Signaler un incident")}
            </Button>
          ) : null}
        </div>
      </header>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Ouverts", metrics.open, "open"],
          ["Enquête", metrics.investigating, "investigating"],
          ["Critiques", metrics.critical, "critical"],
          ["Action requise", metrics.actions, "action_required"],
        ].map(([label, count, key]) => (
          <button
            key={String(key)}
            onClick={() => setStatus(status === key ? "all" : String(key))}
            className={`rounded-2xl border p-4 text-left transition ${status === key ? "border-brand bg-brand/10" : "border-border bg-surface-1 hover:bg-surface-2"}`}
          >
            <p className="text-xs font-semibold text-ink-muted">
              {fr ? label : title(label)}
            </p>
            <p className="mt-2 text-3xl font-semibold text-ink">{count}</p>
          </button>
        ))}
      </section>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_25rem]">
        <section className="overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
            <div>
              <h2 className="font-semibold text-ink">
                {copy(fr, "Incident register", "Registre des incidents")}
              </h2>
              <p className="mt-1 text-xs text-ink-secondary">
                {rows.length}{" "}
                {copy(
                  fr,
                  "record(s) in this view",
                  "enregistrement(s) dans cette vue",
                )}
              </p>
            </div>
            <Select name="status" value={status} onChange={setStatus}>
              <option value="all">
                {copy(fr, "All statuses", "Tous les statuts")}
              </option>
              {["open", "investigating", "action_required", "closed"].map(
                (item) => (
                  <option key={item} value={item}>
                    {title(item)}
                  </option>
                ),
              )}
            </Select>
          </div>
          {rows.length ? (
            <div className="divide-y divide-border">
              {rows.map((item) => (
                <article
                  key={item.id}
                  className="p-4 transition hover:bg-surface-2/70"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-ink">
                          {String(item.title)}
                        </p>
                        <Badge
                          variant={severityTone(item.severity)}
                          icon={false}
                        >
                          {title(item.severity)}
                        </Badge>
                        <Badge variant={statusTone(item.status)} icon={false}>
                          {title(item.status)}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-ink-secondary">
                        {String(item.reference)} · {title(item.category)} ·{" "}
                        {dayTime(item.occurredAt, locale)}
                      </p>
                      <p className="mt-2 line-clamp-2 max-w-2xl text-sm leading-5 text-ink-secondary">
                        {String(item.description)}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-muted">
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" />
                          {String(item.siteName ?? item.provinceName ?? "—")}
                        </span>
                        {item.employeeName ? (
                          <span>{String(item.employeeName)}</span>
                        ) : null}
                        {item.injuryOccurred ? (
                          <span className="font-medium text-critical">
                            {copy(fr, "Injury reported", "Blessure signalée")}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {can(user, "incidents.update") ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setEditor(item)}
                      >
                        <Pencil />
                        {copy(fr, "Manage", "Gérer")}
                      </Button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={AlertTriangle}
              title={copy(
                fr,
                "No incidents in this view",
                "Aucun incident dans cette vue",
              )}
              description={copy(
                fr,
                "Use the action above to create the first safety or operational incident record.",
                "Utilisez l’action ci-dessus pour créer le premier incident de sécurité ou opérationnel.",
              )}
            />
          )}
        </section>
        <aside className="xl:sticky xl:top-6 xl:self-start">
          {editor ? (
            <IncidentEditor
              orgSlug={orgSlug}
              row={editor}
              provinces={provinces.data ?? []}
              sites={sites.data ?? []}
              employees={employees.data ?? []}
              onClose={() => setEditor(null)}
            />
          ) : (
            <section className="rounded-2xl border border-dashed border-border bg-surface-1 p-6">
              <ClipboardPlus className="size-6 text-brand" />
              <h2 className="mt-4 font-semibold text-ink">
                {copy(fr, "Incident workflow", "Flux de traitement")}
              </h2>
              <ol className="mt-3 space-y-3 text-sm leading-5 text-ink-secondary">
                <li>
                  <strong className="text-ink">1.</strong>{" "}
                  {copy(
                    fr,
                    "Record facts and immediate action.",
                    "Enregistrez les faits et l’action immédiate.",
                  )}
                </li>
                <li>
                  <strong className="text-ink">2.</strong>{" "}
                  {copy(
                    fr,
                    "Assign investigation and root cause.",
                    "Attribuez l’enquête et la cause racine.",
                  )}
                </li>
                <li>
                  <strong className="text-ink">3.</strong>{" "}
                  {copy(
                    fr,
                    "Close only after the corrective action is complete.",
                    "Clôturez uniquement après l’action corrective.",
                  )}
                </li>
              </ol>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
function IncidentEditor({
  orgSlug,
  row,
  provinces,
  sites,
  employees,
  onClose,
}: {
  orgSlug: string;
  row: Row | "new";
  provinces: Province[];
  sites: OrganizationSite[];
  employees: Employee[];
  onClose: () => void;
}) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const user = useSessionUser();
  const queryClient = useQueryClient();
  const current = row === "new" ? null : row;
  const [provinceId, setProvinceId] = useState(value(current?.provinceId));
  const [siteId, setSiteId] = useState(value(current?.siteId));
  const isNew = row === "new";
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      isNew
        ? ownerManagementApi.create<{ record: Row }>(orgSlug, "incidents", body)
        : ownerManagementApi.update<{ record: Row }>(
            orgSlug,
            "incidents",
            current!.id,
            body,
          ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["incidents", orgSlug] });
      onClose();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selectedSite = sites.find((site) => site.id === siteId);
    const effectiveProvinceId = selectedSite?.province.id ?? provinceId ?? null;
    const status = value(form.get("status")) || "open";
    const body: Record<string, unknown> = {
      reference: blank(form.get("reference")),
      provinceId: effectiveProvinceId,
      siteId: siteId || null,
      occurredAt: iso(form.get("occurredAt")),
      category: value(form.get("category")),
      severity: value(form.get("severity")),
      title: value(form.get("title")),
      description: value(form.get("description")),
      locationDetail: blank(form.get("locationDetail")),
      employeeId: blank(form.get("employeeId")),
      otherParties: blank(form.get("otherParties")),
      injuryOccurred: form.get("injuryOccurred") === "on",
      daysLost: numberOrNull(form.get("daysLost")),
      estimatedLoss: numberOrNull(form.get("estimatedLoss")),
      currency: blank(form.get("currency")),
      status,
      immediateAction: blank(form.get("immediateAction")),
      rootCause: blank(form.get("rootCause")),
      reportedToAuthorities: form.get("reportedToAuthorities") === "on",
      authorityReference: blank(form.get("authorityReference")),
      investigatedBy: blank(form.get("investigatedBy")),
    };
    if (status === "closed") {
      body.closedAt = new Date().toISOString();
      body.closedBy = user?.id ?? null;
    }
    save.mutate(body);
  };
  const scopedSites = sites.filter(
    (site) => !provinceId || site.province.id === provinceId,
  );
  const failure =
    save.error instanceof ApiError
      ? save.error.message
      : save.error
        ? copy(
            fr,
            "Could not save the incident.",
            "Impossible d’enregistrer l’incident.",
          )
        : null;
  return (
    <section className="rounded-2xl border border-border bg-surface-1 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-ink">
            {isNew
              ? copy(fr, "Report incident", "Signaler un incident")
              : copy(fr, "Manage incident", "Gérer l’incident")}
          </h2>
          <p className="mt-1 text-xs leading-5 text-ink-secondary">
            {copy(
              fr,
              "Required fields are marked. The record stays within the selected company scope.",
              "Les champs obligatoires sont indiqués. Le dossier reste dans le périmètre de l’entreprise.",
            )}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          <X />
        </Button>
      </div>
      <form className="mt-5 grid gap-3" onSubmit={submit} noValidate>
        <Field label={copy(fr, "Title", "Titre")} required>
          <Input name="title" required defaultValue={value(current?.title)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={copy(fr, "Reference", "Référence")}>
            <Input
              name="reference"
              defaultValue={value(current?.reference)}
              placeholder={copy(fr, "Generated when blank", "Générée si vide")}
            />
          </Field>
          <Field label={copy(fr, "Occurrence", "Date et heure")} required>
            <Input
              name="occurredAt"
              type="datetime-local"
              required
              defaultValue={
                localDateTime(current?.occurredAt) ||
                new Date().toISOString().slice(0, 16)
              }
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={copy(fr, "Category", "Catégorie")} required>
            <Select
              name="category"
              value={value(current?.category) || "near_miss"}
              required
            >
              <option value="injury">{copy(fr, "Injury", "Blessure")}</option>
              <option value="near_miss">
                {copy(fr, "Near miss", "Presqu’accident")}
              </option>
              <option value="equipment_damage">
                {copy(fr, "Equipment damage", "Dommage d’équipement")}
              </option>
              <option value="fire">{copy(fr, "Fire", "Incendie")}</option>
              <option value="theft">{copy(fr, "Theft", "Vol")}</option>
              <option value="disease_outbreak">
                {copy(fr, "Disease outbreak", "Foyer de maladie")}
              </option>
              <option value="security_breach">
                {copy(fr, "Security breach", "Atteinte à la sécurité")}
              </option>
              <option value="other">{copy(fr, "Other", "Autre")}</option>
            </Select>
          </Field>
          <Field label={copy(fr, "Severity", "Gravité")}>
            <Select name="severity" value={value(current?.severity) || "minor"}>
              <option value="minor">{copy(fr, "Minor", "Mineure")}</option>
              <option value="moderate">
                {copy(fr, "Moderate", "Modérée")}
              </option>
              <option value="serious">{copy(fr, "Serious", "Grave")}</option>
              <option value="critical">
                {copy(fr, "Critical", "Critique")}
              </option>
              <option value="fatal">{copy(fr, "Fatal", "Mortelle")}</option>
            </Select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={copy(fr, "Province", "Province")}>
            <Select
              name="provinceId"
              value={provinceId}
              onChange={setProvinceId}
            >
              <option value="">
                {copy(
                  fr,
                  "Company-wide / not set",
                  "Toute l’entreprise / non définie",
                )}
              </option>
              {provinces.map((province) => (
                <option key={province.id} value={province.id}>
                  {province.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={copy(fr, "Site / farm", "Site / ferme")}>
            <Select name="siteId" value={siteId} onChange={setSiteId}>
              <option value="">{copy(fr, "Not set", "Non défini")}</option>
              {scopedSites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={copy(fr, "Exact location", "Emplacement précis")}>
          <Input
            name="locationDetail"
            defaultValue={value(current?.locationDetail)}
            placeholder={copy(
              fr,
              "e.g. House 3, feed store",
              "ex. bâtiment 3, magasin d’aliment",
            )}
          />
        </Field>
        <Field
          label={copy(fr, "What happened", "Description des faits")}
          required
        >
          <Textarea
            name="description"
            required
            defaultValue={value(current?.description)}
            rows={4}
          />
        </Field>
        <Field label={copy(fr, "Person involved", "Employé concerné")}>
          <Select name="employeeId" value={value(current?.employeeId)}>
            <option value="">
              {copy(fr, "No employee selected", "Aucun employé sélectionné")}
            </option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.employeeNumber ? `${employee.employeeNumber} · ` : ""}
                {employee.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={copy(fr, "Immediate action", "Action immédiate")}>
            <Textarea
              name="immediateAction"
              defaultValue={value(current?.immediateAction)}
              rows={2}
            />
          </Field>
          <Field label={copy(fr, "Root cause", "Cause racine")}>
            <Textarea
              name="rootCause"
              defaultValue={value(current?.rootCause)}
              rows={2}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={copy(fr, "Estimated loss", "Perte estimée")}>
            <Input
              name="estimatedLoss"
              type="number"
              min="0"
              step="0.01"
              defaultValue={value(current?.estimatedLoss)}
            />
          </Field>
          <Field label={copy(fr, "Currency", "Devise")}>
            <Select name="currency" value={value(current?.currency) || "USD"}>
              <option value="USD">USD</option>
              <option value="CDF">CDF</option>
              <option value="EUR">EUR</option>
            </Select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            name="injuryOccurred"
            type="checkbox"
            defaultChecked={current?.injuryOccurred === true}
            className="size-4 accent-[var(--brand)]"
          />
          {copy(fr, "Injury occurred", "Blessure survenue")}
        </label>
        <Field label={copy(fr, "Days lost", "Jours perdus")}>
          <Input
            name="daysLost"
            type="number"
            min="0"
            defaultValue={value(current?.daysLost)}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            name="reportedToAuthorities"
            type="checkbox"
            defaultChecked={current?.reportedToAuthorities === true}
            className="size-4 accent-[var(--brand)]"
          />
          {copy(fr, "Reported to authorities", "Signalé aux autorités")}
        </label>
        <Field
          label={copy(fr, "Authority reference", "Référence des autorités")}
        >
          <Input
            name="authorityReference"
            defaultValue={value(current?.authorityReference)}
          />
        </Field>
        <Field label={copy(fr, "Status", "Statut")}>
          <Select name="status" value={value(current?.status) || "open"}>
            <option value="open">{copy(fr, "Open", "Ouvert")}</option>
            <option value="investigating">
              {copy(fr, "Investigating", "En enquête")}
            </option>
            <option value="action_required">
              {copy(fr, "Action required", "Action requise")}
            </option>
            <option value="closed">{copy(fr, "Closed", "Clôturé")}</option>
          </Select>
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
            {isNew
              ? copy(fr, "Save incident", "Enregistrer l’incident")
              : copy(fr, "Save changes", "Enregistrer les modifications")}
          </Button>
        </div>
      </form>
    </section>
  );
}
