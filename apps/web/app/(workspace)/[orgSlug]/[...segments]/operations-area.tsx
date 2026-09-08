"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Boxes,
  CheckCircle2,
  ClipboardList,
  FolderKanban,
  Layers3,
  MapPin,
  UserRound,
  Plus,
  Settings2,
  ShoppingCart,
  Truck,
  Wrench,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { ApiError, get, orgApiUrl, orgUrl } from "@/lib/api";
import {
  ownerManagementApi,
  type ManagementBody,
  type OwnerManagementResource,
} from "@/lib/owner-management-api";
import { can } from "@/lib/permissions";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";

export type OperationsAreaKind =
  | "tasks"
  | "inventory"
  | "procurement"
  | "suppliers"
  | "equipment"
  | "maintenance";
type Row = Record<string, unknown> & { id: string };
type Place = { id: string; name: string; code?: string | null };
type Employee = {
  id: string;
  fullName: string;
  employeeNumber?: string | null;
  member?: { memberId?: string | null } | null;
};
type Option = { value: string; label: string };
type FieldType =
  "text" | "number" | "date" | "textarea" | "select" | "checkbox";
type FormField = {
  key: string;
  label: string;
  type?: FieldType;
  required?: boolean;
  options?: Option[];
  noneLabel?: string;
  emptyLabel?: string;
  defaultValue?: string | number | boolean;
  step?: string;
  hint?: string;
};
type RecordsResponse = { records: Row[] };

const text = (value: unknown) => String(value ?? "").trim();
const amount = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const date = (value: unknown) => (value ? String(value).slice(0, 10) : "—");
const today = () => new Date().toISOString().slice(0, 10);
const copy = (fr: boolean, en: string, french: string) => (fr ? french : en);
const supplierTypeLabel = (value: string, fr: boolean) => {
  const labels: Record<string, [string, string]> = {
    materials: ["Materials", "Matériaux"],
    equipment: ["Equipment", "Équipements"],
    livestock: ["Livestock", "Bétail"],
    services: ["Services", "Services"],
    fuel: ["Fuel", "Carburant"],
    transport: ["Transport", "Transport"],
    other: ["Other", "Autre"],
  };
  const label = labels[value];
  return label ? (fr ? label[1] : label[0]) : nice(value);
};
const supplierStatusLabel = (value: string, fr: boolean) => {
  const labels: Record<string, [string, string]> = {
    active: ["Active", "Actif"],
    inactive: ["Inactive", "Inactif"],
    blocked: ["Blocked", "Bloqué"],
  };
  const label = labels[value];
  return label ? (fr ? label[1] : label[0]) : nice(value);
};
const nice = (value: unknown) =>
  text(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "—";
const tone = (value: unknown) =>
  [
    "completed",
    "approved",
    "received",
    "verified",
    "active",
    "available",
  ].includes(text(value))
    ? ("good" as const)
    : [
          "blocked",
          "cancelled",
          "rejected",
          "overdue",
          "out_of_service",
        ].includes(text(value))
      ? ("serious" as const)
      : [
            "in_progress",
            "sent",
            "partially_received",
            "under_maintenance",
          ].includes(text(value))
        ? ("info" as const)
        : ("warning" as const);
const selectOptions = (
  rows: readonly (Row | Place)[],
  names: string[],
): Option[] => {
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const value = text(row.id);
    const label = names.map((name) => text((row as Row)[name])).find(Boolean);
    if (!value || !label || seen.has(value)) return [];
    seen.add(value);
    return [{ value, label }];
  });
};
const memberOptions = (employees: Employee[]): Option[] =>
  employees.flatMap((employee) => {
    const value = text(employee.member?.memberId);
    const label = [text(employee.fullName), text(employee.employeeNumber)]
      .filter(Boolean)
      .join(" · ");
    return value && label ? [{ value, label }] : [];
  });

const permissions: Record<OwnerManagementResource, string> = {
  projects: "projects",
  "project-members": "projects",
  "operational-links": "projects",
  phases: "projects",
  "phase-dependencies": "projects",
  tasks: "tasks",
  "task-dependencies": "tasks",
  "budget-lines": "projects",
  materials: "projects",
  "material-movements": "projects",
  suppliers: "suppliers",
  "inventory-items": "inventory.items",
  warehouses: "inventory.warehouses",
  "stock-movements": "inventory.movements",
  "purchase-requests": "procurement",
  "purchase-request-lines": "procurement",
  "purchase-orders": "procurement",
  "purchase-order-lines": "procurement",
  receipts: "procurement",
  "receipt-lines": "procurement",
  assets: "equipment",
  "asset-assignments": "equipment",
  "asset-movements": "equipment",
  "asset-usage": "equipment",
  "vehicle-profiles": "vehicles",
  "vehicle-trips": "vehicles",
  "maintenance-plans": "maintenance",
  "maintenance-work-orders": "work_orders",
  "maintenance-parts": "maintenance",
  expenses: "finance.expenses",
  approvals: "approvals",
  documents: "documents",
  incidents: "incidents",
  "security-visitors": "security",
  "security-asset-movements": "security",
  "security-keys": "security",
  "security-key-handovers": "security",
};
function useRows(
  orgSlug: string,
  resource: OwnerManagementResource,
  enabled = true,
) {
  return useQuery({
    queryKey: ["operations", orgSlug, resource],
    queryFn: () =>
      ownerManagementApi.list<RecordsResponse>(orgSlug, resource, {
        limit: 200,
      }),
    select: (data) => data.records,
    enabled,
  });
}
function useReferences(orgSlug: string, enabled = true) {
  const provinces = useQuery({
    queryKey: ["operations", orgSlug, "provinces"],
    queryFn: () => get<{ provinces: Place[] }>(orgUrl(orgSlug, "provinces")),
    select: (data) => data.provinces,
    enabled,
  });
  const sites = useQuery({
    queryKey: ["operations", orgSlug, "sites"],
    queryFn: () => get<{ sites: Place[] }>(orgUrl(orgSlug, "sites")),
    select: (data) => data.sites,
    enabled,
  });
  const employees = useQuery({
    queryKey: ["operations", orgSlug, "employees"],
    queryFn: () => get<{ employees: Employee[] }>(orgUrl(orgSlug, "employees")),
    select: (data) => data.employees,
    enabled,
  });
  const membership = useQuery({
    queryKey: ["operations", orgSlug, "membership"],
    queryFn: () =>
      get<{ membership: { memberId: string } }>(orgUrl(orgSlug, "")),
    select: (data) => data.membership,
    enabled,
  });
  return { provinces, sites, employees, membership };
}
function Header({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof ClipboardList;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-brand/20 bg-[linear-gradient(125deg,#0d366b_0%,#2a78d6_100%)] p-5 text-white shadow-sm sm:p-7">
      <Icon className="size-6 text-blue-100" />
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
            {title}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-50/90">
            {description}
          </p>
        </div>
        {action}
      </div>
    </div>
  );
}
function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface-1 p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {description ? (
            <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-secondary">
              {description}
            </p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
function Metric({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm ${warning ? "border-critical/30 bg-critical/10" : "border-border bg-surface-1"}`}
    >
      <p className="text-xs font-medium text-ink-secondary">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">
        {value}
      </p>
    </div>
  );
}
function QueryState({
  query,
  children,
}: {
  query: {
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    refetch: () => unknown;
  };
  children: ReactNode;
}) {
  if (query.isLoading) return <Skeleton className="h-48" />;
  if (query.isError)
    return (
      <ErrorState
        description={
          query.error instanceof Error ? query.error.message : undefined
        }
        onRetry={() => void query.refetch()}
      />
    );
  return <>{children}</>;
}
function SelectControl({ field, value }: { field: FormField; value: unknown }) {
  const list = field.options ?? [];
  if (!list.length)
    return (
      <select
        disabled
        value=""
        className="h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-sm text-ink-muted"
      >
        <option>{field.emptyLabel ?? "No records available"}</option>
      </select>
    );
  return (
    <select
      name={field.key}
      defaultValue={text(value)}
      required={field.required}
      className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
    >
      {!field.required ? (
        <option value="">{field.noneLabel ?? "None"}</option>
      ) : null}
      {list.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
function Editor({
  title,
  subtitle,
  row,
  fields,
  pending,
  error,
  close,
  save,
  fr,
}: {
  title: string;
  subtitle: string;
  row?: Row;
  fields: FormField[];
  pending: boolean;
  error: unknown;
  close: () => void;
  save: (body: ManagementBody) => void;
  fr: boolean;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: ManagementBody = {};
    fields.forEach((field) => {
      const raw = form.get(field.key);
      if (field.type === "checkbox") {
        body[field.key] = raw === "on";
        return;
      }
      const value = text(raw);
      if (!value) {
        if (!field.required) body[field.key] = null;
        return;
      }
      body[field.key] = field.type === "number" ? Number(value) : value;
    });
    save(body);
  };
  const errors = error instanceof ApiError ? error.fieldErrors : {};
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-3"
      role="dialog"
      aria-modal="true"
    >
      <form
        onSubmit={submit}
        className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-surface-1 p-5 shadow-2xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-brand">
              {subtitle}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-ink">{title}</h2>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={close}>
            <X />
          </Button>
        </div>
        {error ? (
          <p className="mt-4 rounded-lg bg-critical/10 px-3 py-2 text-sm text-critical">
            {error instanceof Error
              ? error.message
              : copy(
                  fr,
                  "Could not save this record",
                  "Impossible d’enregistrer cet élément",
                )}
          </p>
        ) : null}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {fields.map((field) => {
            const value = row?.[field.key] ?? field.defaultValue ?? "";
            const control =
              field.type === "textarea" ? (
                <Textarea
                  name={field.key}
                  defaultValue={text(value)}
                  required={field.required}
                />
              ) : field.type === "select" ? (
                <SelectControl field={field} value={value} />
              ) : field.type === "checkbox" ? (
                <label className="flex h-9 items-center gap-2 rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink">
                  <input
                    type="checkbox"
                    name={field.key}
                    defaultChecked={Boolean(value)}
                  />
                  {copy(fr, "Enabled", "Activé")}
                </label>
              ) : (
                <Input
                  name={field.key}
                  type={field.type ?? "text"}
                  step={field.step}
                  defaultValue={text(value)}
                  required={field.required}
                  invalid={Boolean(errors[field.key]?.length)}
                />
              );
            return (
              <Field
                key={field.key}
                htmlFor={field.key}
                label={field.label}
                required={field.required}
                hint={field.hint}
                error={errors[field.key]?.[0]}
                className={
                  field.type === "textarea" ? "sm:col-span-2" : undefined
                }
              >
                {control}
              </Field>
            );
          })}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>
            {copy(fr, "Cancel", "Annuler")}
          </Button>
          <Button type="submit" loading={pending}>
            {copy(fr, "Save", "Enregistrer")}
          </Button>
        </div>
      </form>
    </div>
  );
}
function Rows({
  rows,
  fields,
  open,
  empty,
}: {
  rows: Row[];
  fields: string[];
  open?: (row: Row) => void;
  empty: ReactNode;
}) {
  if (!rows.length) return <>{empty}</>;
  return (
    <div className="divide-y divide-border">
      {rows.map((row, index) => {
        const key = text(row.id) || `row-${index}`;
        const heading =
          text(row.name) ||
          text(row.title) ||
          text(row.code) ||
          text(row.requestNumber) ||
          text(row.orderNumber) ||
          text(row.receiptNumber) ||
          text(row.assetNumber) ||
          text(row.workOrderNumber) ||
          "—";
        return (
          <button
            key={key}
            type="button"
            onClick={() => open?.(row)}
            className="flex w-full items-start justify-between gap-3 py-3 text-left hover:bg-surface-2/70"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">
                {heading}
              </span>
              <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-secondary">
                {fields.map((field) => {
                  const value = row[field];
                  if (value === null || value === undefined || value === "")
                    return null;
                  return (
                    <span key={`${key}-${field}`}>
                      {field === "status" || field === "priority" ? (
                        <Badge variant={tone(value)}>{nice(value)}</Badge>
                      ) : (
                        `${nice(field)}: ${field.toLowerCase().includes("date") ? date(value) : String(value)}`
                      )}
                    </span>
                  );
                })}
              </span>
            </span>
            {open ? (
              <span className="text-xs font-semibold text-brand">Open</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
function Resource({
  orgSlug,
  resource,
  title,
  description,
  rows,
  fields,
  form,
  emptyTitle,
  emptyDescription,
  fr,
  formTitle,
}: {
  orgSlug: string;
  resource: OwnerManagementResource;
  title: string;
  description: string;
  rows: Row[];
  fields: string[];
  form: FormField[];
  emptyTitle: string;
  emptyDescription: string;
  fr: boolean;
  formTitle?: string;
}) {
  const user = useSessionUser();
  const client = useQueryClient();
  const [editor, setEditor] = useState<Row | "new" | null>(null);
  const permission = permissions[resource];
  const create = can(user, `${permission}.create`);
  const update = can(user, `${permission}.update`);
  const mutation = useMutation({
    mutationFn: (body: ManagementBody) =>
      editor && editor !== "new"
        ? ownerManagementApi.update(orgSlug, resource, editor.id, body)
        : ownerManagementApi.create(orgSlug, resource, body),
    onSuccess: () => {
      setEditor(null);
      void client.invalidateQueries({ queryKey: ["operations", orgSlug] });
    },
  });
  return (
    <>
      <Panel
        title={title}
        description={description}
        action={
          create ? (
            <Button size="sm" onClick={() => setEditor("new")}>
              <Plus />
              {copy(fr, "Add", "Ajouter")}
            </Button>
          ) : undefined
        }
      >
        <Rows
          rows={rows}
          fields={fields}
          open={update ? setEditor : undefined}
          empty={
            <EmptyState
              title={emptyTitle}
              description={emptyDescription}
              action={
                create
                  ? {
                      label: copy(fr, "Add", "Ajouter"),
                      onClick: () => setEditor("new"),
                    }
                  : undefined
              }
            />
          }
        />
      </Panel>
      {editor ? (
        <Editor
          title={
            editor === "new"
              ? copy(fr, `Add ${formTitle ?? title}`, `Ajouter ${formTitle ?? title}`)
              : copy(fr, `Edit ${formTitle ?? title}`, `Modifier ${formTitle ?? title}`)
          }
          subtitle={formTitle ?? title}
          row={editor === "new" ? undefined : editor}
          fields={form}
          pending={mutation.isPending}
          error={mutation.error}
          close={() => setEditor(null)}
          save={mutation.mutate}
          fr={fr}
        />
      ) : null}
    </>
  );
}
function TaskDocuments({
  orgSlug,
  task,
  fr,
}: {
  orgSlug: string;
  task: Row;
  fr: boolean;
}) {
  const documents = useQuery({
    queryKey: ["operations", orgSlug, "task-documents", task.id],
    queryFn: () =>
      ownerManagementApi.taskDocuments<{ documents: Row[] }>(orgSlug, task.id),
    select: (data) => data.documents,
    enabled: Boolean(task.projectId),
  });
  return (
    <div className="mt-4 rounded-xl border border-border bg-surface-2 p-3">
      <p className="text-xs font-semibold text-ink">
        {copy(fr, "Documents & evidence", "Documents et preuves")}
      </p>
      {!task.projectId ? (
        <p className="mt-1 text-xs leading-5 text-ink-secondary">
          {copy(
            fr,
            "This normal company task has no project documents.",
            "Cette tâche normale n’a pas de documents de projet.",
          )}
        </p>
      ) : documents.data?.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {documents.data.map((document) => (
            <a
              key={document.id}
              href={orgApiUrl(orgSlug, `files/${document.id}/download`)}
              className="rounded-md border border-border bg-surface-1 px-2 py-1 text-xs text-brand hover:underline"
            >
              {text(document.title) || copy(fr, "Document", "Document")}
            </a>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-xs leading-5 text-ink-secondary">
          {copy(
            fr,
            "No project documents are linked yet.",
            "Aucun document de projet n’est encore lié.",
          )}
        </p>
      )}
    </div>
  );
}
function TasksWorkspace({ orgSlug, fr }: { orgSlug: string; fr: boolean }) {
  const user = useSessionUser();
  const client = useQueryClient();
  const tasks = useRows(orgSlug, "tasks", can(user, "tasks.read"));
  const projects = useRows(orgSlug, "projects", can(user, "projects.read"));
  const phases = useRows(orgSlug, "phases", can(user, "projects.read"));
  const refs = useReferences(
    orgSlug,
    can(user, "sites.read") || can(user, "employees.read"),
  );
  const [filter, setFilter] = useState<
    "mine" | "team" | "project" | "overdue" | "completed"
  >("mine");
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [editor, setEditor] = useState<Row | "new" | null>(null);
  const [documentsTaskId, setDocumentsTaskId] = useState<string | null>(null);
  const allTasks = tasks.data ?? [];
  const memberId = refs.membership.data?.memberId;
  const activeTasks = allTasks.filter(
    (task) => !["completed", "cancelled"].includes(text(task.status)),
  );
  const isOverdue = (task: Row) => {
    const dueDate = text(task.dueDate);
    return (
      Boolean(dueDate) &&
      dueDate < today() &&
      !["completed", "cancelled"].includes(text(task.status))
    );
  };
  const isDueToday = (task: Row) =>
    text(task.dueDate) === today() &&
    !["completed", "cancelled"].includes(text(task.status));
  const viewRows = allTasks.filter((task) => {
    const state = text(task.status);
    if (filter === "mine")
      return memberId ? text(task.assignedMemberId) === memberId : true;
    if (filter === "project") return Boolean(task.projectId);
    if (filter === "overdue") return isOverdue(task);
    if (filter === "completed") return state === "completed";
    return true;
  });
  const projectsById = new Map(
    (projects.data ?? []).map((project) => [text(project.id), project]),
  );
  const phasesById = new Map(
    (phases.data ?? []).map((phase) => [text(phase.id), phase]),
  );
  const sitesById = new Map(
    (refs.sites.data ?? []).map((site) => [text(site.id), site]),
  );
  const provincesById = new Map(
    (refs.provinces.data ?? []).map((province) => [
      text(province.id),
      province,
    ]),
  );
  const people = memberOptions(refs.employees.data ?? []);
  const taskProject = (task: Row) => projectsById.get(text(task.projectId));
  const taskProjectName = (task: Row) =>
    text(task.projectName) || text(taskProject(task)?.name);
  const taskProjectCode = (task: Row) =>
    text(task.projectCode) || text(taskProject(task)?.code);
  const taskPhaseName = (task: Row) =>
    text(task.phaseName) || text(phasesById.get(text(task.phaseId))?.name);
  const taskPhaseCode = (task: Row) =>
    text(task.phaseCode) || text(phasesById.get(text(task.phaseId))?.code);
  const taskSiteName = (task: Row) =>
    text(task.siteName) || text(sitesById.get(text(task.siteId))?.name);
  const taskProvinceName = (task: Row) =>
    text(task.provinceName) ||
    text(provincesById.get(text(task.provinceId))?.name);
  const taskLocation = (task: Row) =>
    [taskSiteName(task), taskProvinceName(task)].filter(Boolean).join(" · ");
  const assignee = (task: Row) =>
    (text(task.assignedMemberName) ||
      people.find((person) => person.value === text(task.assignedMemberId))
        ?.label) ??
    copy(fr, "Unassigned", "Non affectée");
  const taskProjectOptions = Array.from(
    new Map(
      allTasks
        .filter((task) => Boolean(text(task.projectId)))
        .map((task) => {
          const name = taskProjectName(task);
          const code = taskProjectCode(task);
          return [
            text(task.projectId),
            {
              value: text(task.projectId),
              label: [name, code].filter(Boolean).join(" · "),
            },
          ] as const;
        }),
    ).values(),
  ).filter((option) => option.value && option.label);
  const query = search.trim().toLocaleLowerCase();
  const rows = viewRows.filter((task) => {
    const matchesSearch = !query
      ? true
      : [
          task.title,
          task.code,
          task.description,
          task.blockedReason,
          taskProjectName(task),
          taskProjectCode(task),
          taskPhaseName(task),
          taskPhaseCode(task),
          taskSiteName(task),
          taskProvinceName(task),
          assignee(task),
        ]
          .map((value) => text(value).toLocaleLowerCase())
          .join(" ")
          .includes(query);
    const matchesProject =
      projectFilter === "all"
        ? true
        : projectFilter === "company"
          ? !text(task.projectId)
          : text(task.projectId) === projectFilter;
    return (
      matchesSearch &&
      matchesProject &&
      (priority === "all" || text(task.priority) === priority)
    );
  });
  const visibleCompletion = viewRows.length
    ? Math.round(
        (viewRows.filter((task) => text(task.status) === "completed").length /
          viewRows.length) *
          100,
      )
    : 0;
  const focusTasks = [...activeTasks]
    .filter((task) => Boolean(text(task.dueDate)) || text(task.blockedReason))
    .sort((a, b) => {
      if (isOverdue(a) !== isOverdue(b)) return isOverdue(a) ? -1 : 1;
      if (text(a.blockedReason) !== text(b.blockedReason))
        return text(a.blockedReason) ? -1 : 1;
      return text(a.dueDate).localeCompare(text(b.dueDate));
    })
    .slice(0, 4);
  const taskFields: FormField[] = [
    {
      key: "title",
      label: copy(fr, "Task title", "Titre de la tâche"),
      required: true,
    },
    {
      key: "code",
      label: copy(fr, "Task code", "Code de la tâche"),
      hint: copy(fr, "Generated if blank.", "Généré si vide."),
    },
    {
      key: "taskType",
      label: copy(fr, "Type", "Type"),
      type: "select",
      required: true,
      defaultValue: "work",
      options: [
        { value: "work", label: copy(fr, "Work", "Travail") },
        { value: "milestone", label: copy(fr, "Milestone", "Jalon") },
      ],
    },
    {
      key: "projectId",
      label: copy(fr, "Project", "Projet"),
      type: "select",
      options: selectOptions(projects.data ?? [], ["name", "code"]),
      noneLabel: copy(
        fr,
        "Normal company task",
        "Tâche normale de l’entreprise",
      ),
      emptyLabel: copy(fr, "No projects available", "Aucun projet disponible"),
    },
    {
      key: "provinceId",
      label: copy(fr, "Province", "Province"),
      type: "select",
      options: selectOptions(refs.provinces.data ?? [], ["name", "code"]),
      emptyLabel: copy(
        fr,
        "No provinces available",
        "Aucune province disponible",
      ),
      hint: copy(
        fr,
        "Required for a normal company task.",
        "Obligatoire pour une tâche normale.",
      ),
    },
    {
      key: "siteId",
      label: copy(fr, "Site / farm", "Site / ferme"),
      type: "select",
      options: selectOptions(refs.sites.data ?? [], ["name", "code"]),
      emptyLabel: copy(fr, "No sites available", "Aucun site disponible"),
    },
    {
      key: "phaseId",
      label: copy(fr, "Project phase", "Phase du projet"),
      type: "select",
      options: selectOptions(phases.data ?? [], ["name", "code"]),
      emptyLabel: copy(fr, "No phases available", "Aucune phase disponible"),
    },
    {
      key: "assignedMemberId",
      label: copy(fr, "Assignee", "Personne affectée"),
      type: "select",
      options: people,
      emptyLabel: copy(
        fr,
        "No employees available",
        "Aucun employé disponible",
      ),
    },
    {
      key: "priority",
      label: copy(fr, "Priority", "Priorité"),
      type: "select",
      defaultValue: "medium",
      required: true,
      options: ["low", "medium", "high", "critical"].map((value) => ({
        value,
        label: nice(value),
      })),
    },
    {
      key: "status",
      label: copy(fr, "Status", "Statut"),
      type: "select",
      defaultValue: "not_started",
      required: true,
      options: [
        "not_started",
        "in_progress",
        "blocked",
        "waiting_approval",
        "completed",
        "cancelled",
      ].map((value) => ({ value, label: nice(value) })),
    },
    {
      key: "progressPercent",
      label: copy(fr, "Progress (%)", "Avancement (%)"),
      type: "number",
      step: "1",
      defaultValue: 0,
    },
    {
      key: "startDate",
      label: copy(fr, "Start date", "Date de début"),
      type: "date",
    },
    {
      key: "dueDate",
      label: copy(fr, "Due date", "Date d’échéance"),
      type: "date",
    },
    {
      key: "estimatedCost",
      label: copy(fr, "Estimated cost", "Coût estimé"),
      type: "number",
      step: "0.01",
    },
    {
      key: "description",
      label: copy(fr, "Instructions", "Instructions"),
      type: "textarea",
    },
    {
      key: "blockedReason",
      label: copy(fr, "Blocker", "Blocage"),
      type: "textarea",
    },
    { key: "notes", label: copy(fr, "Notes", "Notes"), type: "textarea" },
  ];
  const save = useMutation({
    mutationFn: (body: ManagementBody) =>
      editor && editor !== "new"
        ? ownerManagementApi.update(orgSlug, "tasks", editor.id, body)
        : ownerManagementApi.create(orgSlug, "tasks", body),
    onSuccess: () => {
      setEditor(null);
      void client.invalidateQueries({ queryKey: ["operations", orgSlug] });
    },
  });
  const complete = useMutation({
    mutationFn: (task: Row) =>
      ownerManagementApi.update(orgSlug, "tasks", task.id, {
        status: "completed",
        progressPercent: 100,
      }),
    onSuccess: () =>
      void client.invalidateQueries({
        queryKey: ["operations", orgSlug, "tasks"],
      }),
  });
  const tabs = {
    mine: copy(fr, "My tasks", "Mes tâches"),
    team: copy(fr, "Team tasks", "Tâches d’équipe"),
    project: copy(fr, "Project tasks", "Tâches de projet"),
    overdue: copy(fr, "Overdue", "En retard"),
    completed: copy(fr, "Completed", "Terminées"),
  };
  const tabCount = (key: keyof typeof tabs) => {
    if (key === "mine")
      return memberId
        ? allTasks.filter((task) => text(task.assignedMemberId) === memberId)
            .length
        : allTasks.length;
    if (key === "project")
      return allTasks.filter((task) => task.projectId).length;
    if (key === "overdue") return allTasks.filter(isOverdue).length;
    if (key === "completed")
      return allTasks.filter((task) => text(task.status) === "completed")
        .length;
    return allTasks.length;
  };
  const priorityClass = (value: unknown) =>
    text(value) === "critical"
      ? "bg-critical"
      : text(value) === "high"
        ? "bg-orange-500"
        : text(value) === "medium"
          ? "bg-amber-400"
          : "bg-brand";

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <Header
        icon={ClipboardList}
        title={copy(fr, "Tasks", "Tâches")}
        description={copy(
          fr,
          "A focused work queue for daily operations, site work, and project delivery.",
          "Une file de travail claire pour les opérations quotidiennes, les sites et les projets.",
        )}
        action={
          can(user, "tasks.create") ? (
            <Button onClick={() => setEditor("new")}>
              <Plus />
              {copy(fr, "Create task", "Créer une tâche")}
            </Button>
          ) : undefined
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="relative overflow-hidden rounded-2xl border border-brand/20 bg-brand p-4 text-white shadow-sm">
          <p className="text-xs font-medium text-blue-50">
            {copy(fr, "Open work", "Travail ouvert")}
          </p>
          <p className="mt-2 text-3xl font-semibold tabular-nums">
            {activeTasks.length}
          </p>
          <p className="mt-1 text-xs text-blue-100">
            {copy(fr, "Needs follow-up", "À suivre")}
          </p>
          <ClipboardList className="absolute -right-3 -bottom-4 size-20 text-white/10" />
        </div>
        <div className="rounded-2xl border border-border bg-surface-1 p-4 shadow-sm">
          <p className="text-xs font-medium text-ink-secondary">
            {copy(fr, "Due today", "À faire aujourd’hui")}
          </p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-ink">
            {allTasks.filter(isDueToday).length}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {copy(
              fr,
              "Keep the operation moving",
              "Pour faire avancer l’activité",
            )}
          </p>
        </div>
        <div
          className={`rounded-2xl border p-4 shadow-sm ${allTasks.filter(isOverdue).length ? "border-critical/30 bg-critical/10" : "border-border bg-surface-1"}`}
        >
          <p className="text-xs font-medium text-ink-secondary">
            {copy(fr, "Overdue", "En retard")}
          </p>
          <p
            className={`mt-2 text-3xl font-semibold tabular-nums ${allTasks.filter(isOverdue).length ? "text-critical" : "text-ink"}`}
          >
            {allTasks.filter(isOverdue).length}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {copy(fr, "Needs a decision", "Nécessite une décision")}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-surface-1 p-4 shadow-sm">
          <p className="text-xs font-medium text-ink-secondary">
            {copy(fr, "Completion", "Achèvement")}
          </p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-ink">
            {visibleCompletion}%
          </p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-brand"
              style={{ width: `${visibleCompletion}%` }}
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface-1 p-3 shadow-sm sm:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1">
            {(Object.keys(tabs) as Array<keyof typeof tabs>).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition sm:text-sm ${filter === key ? "bg-surface-1 text-brand shadow-sm" : "text-ink-secondary hover:text-ink"}`}
              >
                {tabs[key]}
                <span
                  className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] ${filter === key ? "bg-brand/10 text-brand" : "bg-surface-3 text-ink-muted"}`}
                >
                  {tabCount(key)}
                </span>
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={copy(
                fr,
                "Search title, code or blocker…",
                "Rechercher un titre, code ou blocage…",
              )}
              className="min-w-0 sm:w-64"
            />
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              className="h-9 rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
              aria-label={copy(
                fr,
                "Filter by priority",
                "Filtrer par priorité",
              )}
            >
              <option value="all">
                {copy(fr, "All priorities", "Toutes les priorités")}
              </option>
              {["critical", "high", "medium", "low"].map((value) => (
                <option key={value} value={value}>
                  {nice(value)}
                </option>
              ))}
            </select>
            <select
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
              className="h-9 min-w-0 rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink sm:max-w-60"
              aria-label={copy(fr, "Filter by project", "Filtrer par projet")}
            >
              <option value="all">
                {copy(fr, "All work", "Tout le travail")}
              </option>
              <option value="company">
                {copy(fr, "Company work only", "Tâches d’entreprise")}
              </option>
              {taskProjectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <QueryState query={tasks}>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
          <section className="rounded-2xl border border-border bg-surface-1 p-4 shadow-sm sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.12em] text-brand">
                  {copy(fr, "Work queue", "File de travail")}
                </p>
                <h2 className="mt-1 text-lg font-semibold text-ink">
                  {rows.length === 1
                    ? copy(fr, "1 task to review", "1 tâche à examiner")
                    : copy(
                        fr,
                        `${rows.length} tasks to review`,
                        `${rows.length} tâches à examiner`,
                      )}
                </h2>
              </div>
              {(search || priority !== "all" || projectFilter !== "all") && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setPriority("all");
                    setProjectFilter("all");
                  }}
                  className="text-xs font-semibold text-brand hover:underline"
                >
                  {copy(fr, "Clear filters", "Effacer les filtres")}
                </button>
              )}
            </div>

            {rows.length ? (
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {rows.map((task) => {
                  const project = taskProject(task);
                  const projectName = taskProjectName(task);
                  const projectCode = taskProjectCode(task);
                  const phaseName = taskPhaseName(task);
                  const phaseCode = taskPhaseCode(task);
                  const location = taskLocation(task);
                  const overdue = isOverdue(task);
                  const progress = Math.min(
                    100,
                    Math.max(0, amount(task.progressPercent)),
                  );
                  const openDocuments = documentsTaskId === task.id;
                  return (
                    <article
                      key={task.id}
                      className="group relative overflow-hidden rounded-xl border border-border bg-surface-1 p-4 transition hover:-translate-y-0.5 hover:border-brand/35 hover:shadow-md"
                    >
                      <span
                        className={`absolute inset-y-0 left-0 w-1 ${priorityClass(task.priority)}`}
                      />
                      <div className="pl-2">
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            className="min-w-0 text-left"
                            onClick={() => setEditor(task)}
                          >
                            <p className="truncate text-base font-semibold text-ink group-hover:text-brand">
                              {text(task.title) ||
                                copy(fr, "Untitled task", "Tâche sans titre")}
                            </p>
                            <p className="mt-1 truncate text-xs text-ink-secondary">
                              {text(task.code) || "—"} ·{" "}
                              {projectName
                                ? `${copy(fr, "Project", "Projet")} : ${projectName}`
                                : copy(
                                    fr,
                                    "Normal company work",
                                    "Tâche normale de l’entreprise",
                                  )}
                            </p>
                          </button>
                          <Badge variant={tone(task.status)}>
                            {nice(task.status)}
                          </Badge>
                        </div>

                        {text(task.description) ? (
                          <p className="mt-3 line-clamp-2 text-xs leading-5 text-ink-secondary">
                            {text(task.description)}
                          </p>
                        ) : null}

                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                          <div className="min-w-0 rounded-lg border border-border bg-surface-2 px-3 py-2">
                            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[.1em] text-ink-muted">
                              <FolderKanban className="size-3 text-brand" />
                              {projectName
                                ? copy(fr, "Project", "Projet")
                                : copy(fr, "Work type", "Type de travail")}
                            </span>
                            <p className="mt-1 truncate text-xs font-semibold text-ink">
                              {projectName ||
                                copy(
                                  fr,
                                  "Company work",
                                  "Travail d’entreprise",
                                )}
                            </p>
                            {projectCode ? (
                              <p className="mt-0.5 truncate text-[11px] text-ink-secondary">
                                {projectCode}
                              </p>
                            ) : null}
                          </div>
                          <div className="min-w-0 rounded-lg border border-border bg-surface-2 px-3 py-2">
                            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[.1em] text-ink-muted">
                              <Layers3 className="size-3 text-brand" />
                              {copy(fr, "Phase", "Phase")}
                            </span>
                            <p className="mt-1 truncate text-xs font-semibold text-ink">
                              {phaseName ||
                                copy(fr, "No phase", "Aucune phase")}
                            </p>
                            {phaseCode ? (
                              <p className="mt-0.5 truncate text-[11px] text-ink-secondary">
                                {phaseCode}
                              </p>
                            ) : null}
                          </div>
                          <div className="min-w-0 rounded-lg border border-border bg-surface-2 px-3 py-2">
                            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[.1em] text-ink-muted">
                              <MapPin className="size-3 text-brand" />
                              {copy(fr, "Work location", "Lieu de travail")}
                            </span>
                            <p className="mt-1 truncate text-xs font-semibold text-ink">
                              {location ||
                                copy(fr, "Not specified", "Non précisé")}
                            </p>
                          </div>
                        </div>

                        <div className="mt-4">
                          <div className="flex items-center justify-between text-[11px] font-medium text-ink-secondary">
                            <span>{copy(fr, "Progress", "Avancement")}</span>
                            <span className="tabular-nums text-ink">
                              {progress}%
                            </span>
                          </div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
                            <div
                              className="h-full rounded-full bg-brand transition-all"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        </div>

                        <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 text-xs">
                          <div>
                            <dt className="text-ink-muted">
                              {copy(fr, "Due", "Échéance")}
                            </dt>
                            <dd
                              className={`mt-0.5 font-medium ${overdue ? "text-critical" : "text-ink"}`}
                            >
                              {overdue
                                ? `${copy(fr, "Overdue", "En retard")} · `
                                : ""}
                              {date(task.dueDate)}
                            </dd>
                          </div>
                          <div>
                            <dt className="flex items-center gap-1 text-ink-muted">
                              <UserRound className="size-3" />
                              {copy(fr, "Assignee", "Affectée à")}
                            </dt>
                            <dd className="mt-0.5 truncate font-medium text-ink">
                              {assignee(task)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-ink-muted">
                              {copy(fr, "Priority", "Priorité")}
                            </dt>
                            <dd className="mt-1">
                              <Badge variant={tone(task.priority)}>
                                {nice(task.priority)}
                              </Badge>
                            </dd>
                          </div>
                          <div>
                            <dt className="text-ink-muted">
                              {copy(fr, "Task type", "Type de tâche")}
                            </dt>
                            <dd className="mt-0.5 truncate font-medium text-ink">
                              {nice(task.taskType || "work")}
                            </dd>
                          </div>
                        </dl>

                        {text(task.blockedReason) ? (
                          <p className="mt-4 rounded-lg border border-critical/20 bg-critical/10 px-3 py-2 text-xs leading-5 text-critical">
                            <span className="font-semibold">
                              {copy(fr, "Blocked", "Bloquée")}:
                            </span>{" "}
                            {text(task.blockedReason)}
                          </p>
                        ) : null}

                        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                          <div>
                            {task.projectId ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setDocumentsTaskId(
                                    openDocuments ? null : task.id,
                                  )
                                }
                                className="text-xs font-semibold text-brand hover:underline"
                              >
                                {openDocuments
                                  ? copy(
                                      fr,
                                      "Hide documents",
                                      "Masquer les documents",
                                    )
                                  : copy(
                                      fr,
                                      "Documents & evidence",
                                      "Documents et preuves",
                                    )}
                              </button>
                            ) : null}
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setEditor(task)}
                            >
                              {copy(fr, "Open", "Ouvrir")}
                            </Button>
                            {text(task.status) !== "completed" &&
                            can(user, "tasks.update") ? (
                              <Button
                                size="sm"
                                loading={complete.isPending}
                                onClick={() => complete.mutate(task)}
                              >
                                <CheckCircle2 />
                                {copy(fr, "Complete", "Terminer")}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        {openDocuments ? (
                          <TaskDocuments
                            orgSlug={orgSlug}
                            task={task}
                            fr={fr}
                          />
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="py-8">
                <EmptyState
                  title={copy(
                    fr,
                    "No matching tasks",
                    "Aucune tâche correspondante",
                  )}
                  description={copy(
                    fr,
                    "Try another view or create a normal task for your company.",
                    "Essayez une autre vue ou créez une tâche normale pour votre entreprise.",
                  )}
                  action={
                    can(user, "tasks.create")
                      ? {
                          label: copy(fr, "Create task", "Créer une tâche"),
                          onClick: () => setEditor("new"),
                        }
                      : undefined
                  }
                />
              </div>
            )}
          </section>

          <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
            <section className="overflow-hidden rounded-2xl border border-ink/10 bg-[linear-gradient(145deg,#102b4c_0%,#1d5fa8_100%)] p-5 text-white shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[.12em] text-blue-100">
                {copy(fr, "Focus now", "Priorité maintenant")}
              </p>
              <h2 className="mt-2 text-lg font-semibold">
                {focusTasks.length
                  ? copy(
                      fr,
                      "The next work that needs attention",
                      "Le travail qui mérite votre attention",
                    )
                  : copy(fr, "Your queue is clear", "Votre file est claire")}
              </h2>
              <div className="mt-4 space-y-2">
                {focusTasks.length ? (
                  focusTasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => setEditor(task)}
                      className="w-full rounded-xl border border-white/15 bg-white/10 p-3 text-left transition hover:bg-white/15"
                    >
                      <p className="truncate text-sm font-semibold">
                        {text(task.title)}
                      </p>
                      <p className="mt-1 truncate text-xs text-blue-100">
                        {taskProjectName(task)
                          ? `${copy(fr, "Project", "Projet")}: ${taskProjectName(task)}`
                          : taskLocation(task) ||
                            copy(fr, "Company work", "Travail d’entreprise")}
                      </p>
                      <p className="mt-1 text-xs text-blue-100/80">
                        {text(task.blockedReason)
                          ? copy(fr, "Blocked", "Bloquée")
                          : `${copy(fr, "Due", "Échéance")}: ${date(task.dueDate)}`}
                      </p>
                    </button>
                  ))
                ) : (
                  <p className="text-sm leading-6 text-blue-100">
                    {copy(
                      fr,
                      "No overdue, blocked, or scheduled task needs immediate action.",
                      "Aucune tâche en retard, bloquée ou prévue ne demande d’action immédiate.",
                    )}
                  </p>
                )}
              </div>
            </section>
            <section className="rounded-2xl border border-border bg-surface-1 p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[.12em] text-ink-muted">
                {copy(fr, "How to use this page", "Utilisation")}
              </p>
              <ul className="mt-3 space-y-3 text-xs leading-5 text-ink-secondary">
                <li>
                  <span className="font-semibold text-ink">1.</span>{" "}
                  {copy(
                    fr,
                    "Open a card to assign work, set dates, and add instructions.",
                    "Ouvrez une carte pour affecter le travail, fixer les dates et ajouter les consignes.",
                  )}
                </li>
                <li>
                  <span className="font-semibold text-ink">2.</span>{" "}
                  {copy(
                    fr,
                    "Complete work here; the same update is reflected in the related project.",
                    "Terminez le travail ici : la même mise à jour apparaît dans le projet lié.",
                  )}
                </li>
                <li>
                  <span className="font-semibold text-ink">3.</span>{" "}
                  {copy(
                    fr,
                    "Project evidence remains attached to the task without duplicating files.",
                    "Les preuves de projet restent liées à la tâche sans dupliquer les fichiers.",
                  )}
                </li>
              </ul>
            </section>
          </aside>
        </div>
      </QueryState>
      {editor ? (
        <Editor
          title={
            editor === "new"
              ? copy(fr, "Create task", "Créer une tâche")
              : copy(fr, "Edit task", "Modifier la tâche")
          }
          subtitle={copy(fr, "Shared Operations", "Opérations partagées")}
          row={editor === "new" ? undefined : editor}
          fields={taskFields}
          pending={save.isPending}
          error={save.error}
          close={() => setEditor(null)}
          save={(body) => {
            if (!body.projectId) body.phaseId = null;
            save.mutate(body);
          }}
          fr={fr}
        />
      ) : null}
    </main>
  );
}
function InventoryWorkspace({ orgSlug, fr }: { orgSlug: string; fr: boolean }) {
  const user = useSessionUser();
  const client = useQueryClient();
  const items = useRows(
    orgSlug,
    "inventory-items",
    can(user, "inventory.items.read"),
  );
  const warehouses = useRows(
    orgSlug,
    "warehouses",
    can(user, "inventory.warehouses.read"),
  );
  const movements = useRows(
    orgSlug,
    "stock-movements",
    can(user, "inventory.movements.read"),
  );
  const refs = useReferences(
    orgSlug,
    can(user, "sites.read") || can(user, "employees.read"),
  );
  const balances = useQuery({
    queryKey: ["operations", orgSlug, "inventory-stock"],
    queryFn: () => ownerManagementApi.stockBalances<RecordsResponse>(orgSlug),
    select: (data) => data.records,
    enabled: can(user, "inventory.stock.read"),
  });
  const [movement, setMovement] = useState(false);
  const recordMovement = useMutation({
    mutationFn: (body: ManagementBody) =>
      ownerManagementApi.create(orgSlug, "stock-movements", body),
    onSuccess: () => {
      setMovement(false);
      void client.invalidateQueries({ queryKey: ["operations", orgSlug] });
    },
  });
  const itemFields: FormField[] = [
    {
      key: "code",
      label: copy(fr, "Item code / SKU", "Code article / SKU"),
      required: true,
    },
    {
      key: "name",
      label: copy(fr, "Item name", "Nom de l’article"),
      required: true,
    },
    { key: "category", label: copy(fr, "Category", "Catégorie") },
    {
      key: "unit",
      label: copy(fr, "Unit", "Unité"),
      required: true,
      defaultValue: "kg",
    },
    {
      key: "reorderLevel",
      label: copy(fr, "Reorder level", "Seuil de réapprovisionnement"),
      type: "number",
      step: "0.001",
    },
    {
      key: "standardUnitCost",
      label: copy(fr, "Standard unit cost", "Coût unitaire standard"),
      type: "number",
      step: "0.01",
    },
    {
      key: "isActive",
      label: copy(fr, "Active", "Actif"),
      type: "checkbox",
      defaultValue: true,
    },
    { key: "notes", label: copy(fr, "Notes", "Notes"), type: "textarea" },
  ];
  const storageFields: FormField[] = [
    {
      key: "siteId",
      label: copy(fr, "Site / farm", "Site / ferme"),
      type: "select",
      required: true,
      options: selectOptions(refs.sites.data ?? [], ["name", "code"]),
      emptyLabel: copy(fr, "No sites available", "Aucun site disponible"),
    },
    {
      key: "code",
      label: copy(fr, "Storage code", "Code de stockage"),
      required: true,
    },
    {
      key: "name",
      label: copy(fr, "Warehouse / storage", "Entrepôt / stockage"),
      required: true,
    },
    {
      key: "managerMemberId",
      label: copy(fr, "Responsible person", "Responsable"),
      type: "select",
      options: memberOptions(refs.employees.data ?? []),
      emptyLabel: copy(
        fr,
        "No employees available",
        "Aucun employé disponible",
      ),
    },
    {
      key: "isActive",
      label: copy(fr, "Active", "Actif"),
      type: "checkbox",
      defaultValue: true,
    },
    { key: "notes", label: copy(fr, "Notes", "Notes"), type: "textarea" },
  ];
  const movementFields: FormField[] = [
    {
      key: "warehouseId",
      label: copy(fr, "Warehouse / storage", "Entrepôt / stockage"),
      type: "select",
      required: true,
      options: selectOptions(warehouses.data ?? [], ["name", "code"]),
      emptyLabel: copy(
        fr,
        "No storage locations available",
        "Aucun emplacement disponible",
      ),
    },
    {
      key: "itemId",
      label: copy(fr, "Inventory item", "Article de stock"),
      type: "select",
      required: true,
      options: selectOptions(items.data ?? [], ["name", "code"]),
      emptyLabel: copy(
        fr,
        "No inventory items available",
        "Aucun article disponible",
      ),
    },
    {
      key: "movementType",
      label: copy(fr, "Movement type", "Type de mouvement"),
      type: "select",
      required: true,
      defaultValue: "receipt",
      options: [
        "receipt",
        "issue",
        "return",
        "adjustment_in",
        "adjustment_out",
        "transfer_in",
        "transfer_out",
        "maintenance_issue",
      ].map((value) => ({ value, label: nice(value) })),
    },
    {
      key: "quantityDelta",
      label: copy(fr, "Quantity change (+/-)", "Variation de quantité (+/-)"),
      type: "number",
      required: true,
      step: "0.001",
      hint: copy(
        fr,
        "Negative = stock leaves the warehouse.",
        "Négatif = sortie de stock.",
      ),
    },
    {
      key: "movementDate",
      label: copy(fr, "Movement date", "Date du mouvement"),
      type: "date",
      defaultValue: today(),
    },
    {
      key: "unitCost",
      label: copy(fr, "Unit cost", "Coût unitaire"),
      type: "number",
      step: "0.01",
    },
    { key: "notes", label: copy(fr, "Notes", "Notes"), type: "textarea" },
  ];
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <Header
        icon={Boxes}
        title={copy(fr, "Inventory", "Inventaire")}
        description={copy(
          fr,
          "Physical company stock. Project materials, receipts, and use link here instead of creating a separate project balance.",
          "Le stock physique de l’entreprise. Les matériaux, réceptions et utilisations de projet s’y lient sans créer un deuxième solde.",
        )}
        action={
          can(user, "inventory.movements.create") ? (
            <Button onClick={() => setMovement(true)}>
              <Plus />
              {copy(fr, "Record movement", "Enregistrer un mouvement")}
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-4 md:grid-cols-3">
        <Metric
          label={copy(fr, "Stock balances", "Soldes de stock")}
          value={String((balances.data ?? []).length)}
        />
        <Metric
          label={copy(fr, "Inventory items", "Articles de stock")}
          value={String((items.data ?? []).length)}
        />
        <Metric
          label={copy(fr, "Storage locations", "Emplacements de stockage")}
          value={String((warehouses.data ?? []).length)}
        />
      </div>
      <QueryState query={balances}>
        <Panel
          title={copy(fr, "Stock by location", "Stock par emplacement")}
          description={copy(
            fr,
            "Available = on hand minus reserved.",
            "Disponible = en stock moins réservé.",
          )}
        >
          {balances.data?.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {balances.data.map((balance) => (
                <div
                  key={balance.id}
                  className="rounded-xl border border-border bg-surface-2 p-3"
                >
                  <p className="text-sm font-semibold text-ink">
                    {text(balance.itemName)}
                  </p>
                  <p className="mt-1 text-xs text-ink-secondary">
                    {text(balance.warehouseName)} · {text(balance.siteName)}
                  </p>
                  <p className="mt-3 text-xl font-semibold text-ink">
                    {amount(balance.quantityAvailable).toLocaleString()}{" "}
                    <span className="text-sm text-ink-secondary">
                      {text(balance.itemUnit)}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {copy(fr, "On hand", "En stock")}:{" "}
                    {amount(balance.quantityOnHand)} ·{" "}
                    {copy(fr, "Reserved", "Réservé")}:{" "}
                    {amount(balance.quantityReserved)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title={copy(fr, "No stock recorded", "Aucun stock enregistré")}
              description={copy(
                fr,
                "Receive or adjust stock after creating an item and storage location.",
                "Réceptionnez ou ajustez le stock après avoir créé un article et un emplacement.",
              )}
            />
          )}
        </Panel>
      </QueryState>
      <div className="grid gap-5 xl:grid-cols-2">
        <QueryState query={items}>
          <Resource
            orgSlug={orgSlug}
            resource="inventory-items"
            title={copy(fr, "Inventory items", "Articles de stock")}
            description={copy(
              fr,
              "These items appear in Project Materials and Procurement selectors.",
              "Ces articles apparaissent dans les sélecteurs de Matériaux de projet et Achats.",
            )}
            rows={items.data ?? []}
            fields={["code", "category", "unit", "reorderLevel"]}
            form={itemFields}
            emptyTitle={copy(
              fr,
              "No inventory items",
              "Aucun article de stock",
            )}
            emptyDescription={copy(
              fr,
              "Add the first item to use it in stock and project records.",
              "Ajoutez le premier article pour l’utiliser dans le stock et les projets.",
            )}
            fr={fr}
          />
        </QueryState>
        <QueryState query={warehouses}>
          <Resource
            orgSlug={orgSlug}
            resource="warehouses"
            title={copy(fr, "Warehouses & storage", "Entrepôts et stockage")}
            description={copy(
              fr,
              "Every physical balance belongs to a warehouse or storage location.",
              "Chaque solde physique appartient à un entrepôt ou emplacement.",
            )}
            rows={warehouses.data ?? []}
            fields={["code", "siteId", "isActive"]}
            form={storageFields}
            emptyTitle={copy(
              fr,
              "No storage locations",
              "Aucun emplacement de stockage",
            )}
            emptyDescription={copy(
              fr,
              "Add a warehouse before receiving stock.",
              "Ajoutez un entrepôt avant de réceptionner du stock.",
            )}
            fr={fr}
          />
        </QueryState>
      </div>
      <QueryState query={movements}>
        <Panel
          title={copy(
            fr,
            "Stock movement history",
            "Historique des mouvements",
          )}
          description={copy(
            fr,
            "Every stock movement is an immutable ledger entry.",
            "Chaque mouvement de stock est une écriture de registre immuable.",
          )}
        >
          <Rows
            rows={movements.data ?? []}
            fields={["movementType", "quantityDelta", "movementDate", "notes"]}
            empty={
              <EmptyState
                title={copy(
                  fr,
                  "No stock movements",
                  "Aucun mouvement de stock",
                )}
              />
            }
          />
        </Panel>
      </QueryState>
      {movement ? (
        <Editor
          title={copy(
            fr,
            "Record stock movement",
            "Enregistrer un mouvement de stock",
          )}
          subtitle={copy(fr, "Inventory", "Inventaire")}
          fields={movementFields}
          pending={recordMovement.isPending}
          error={recordMovement.error}
          close={() => setMovement(false)}
          save={recordMovement.mutate}
          fr={fr}
        />
      ) : null}
    </main>
  );
}
function SuppliersWorkspace({ orgSlug, fr }: { orgSlug: string; fr: boolean }) {
  const user = useSessionUser();
  const suppliers = useRows(orgSlug, "suppliers", can(user, "suppliers.read"));
  const fields: FormField[] = [
    {
      key: "code",
      label: copy(fr, "Supplier code", "Code fournisseur"),
      required: true,
    },
    {
      key: "name",
      label: copy(fr, "Supplier name", "Nom du fournisseur"),
      required: true,
    },
    {
      key: "supplierType",
      label: copy(fr, "Supplier type", "Type de fournisseur"),
      type: "select",
      defaultValue: "other",
      required: true,
      options: [
        "materials",
        "equipment",
        "livestock",
        "services",
        "fuel",
        "transport",
        "other",
      ].map((value) => ({ value, label: supplierTypeLabel(value, fr) })),
    },
    {
      key: "contactName",
      label: copy(fr, "Contact person", "Personne de contact"),
    },
    { key: "phone", label: copy(fr, "Phone", "Téléphone") },
    { key: "email", label: copy(fr, "Email", "E-mail") },
    { key: "address", label: copy(fr, "Address", "Adresse") },
    {
      key: "taxNumber",
      label: copy(
        fr,
        "Tax / registration number",
        "Numéro fiscal / d’enregistrement",
      ),
    },
    {
      key: "status",
      label: copy(fr, "Status", "Statut"),
      type: "select",
      defaultValue: "active",
      required: true,
      options: ["active", "inactive", "blocked"].map((value) => ({
        value,
        label: supplierStatusLabel(value, fr),
      })),
    },
    { key: "notes", label: copy(fr, "Notes", "Notes"), type: "textarea" },
  ];
  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <Header
        icon={Truck}
        title={copy(fr, "Suppliers", "Fournisseurs")}
        description={copy(
          fr,
          "A shared supplier catalogue for Project Materials, purchase requests, and purchase orders.",
          "Un catalogue partagé de fournisseurs pour les matériaux de projet, les demandes et les commandes.",
        )}
      />
      <QueryState query={suppliers}>
        <Resource
          orgSlug={orgSlug}
          resource="suppliers"
          title={copy(fr, "Supplier directory", "Répertoire fournisseurs")}
          description={copy(
            fr,
            "Readable active suppliers become available in every related selector.",
            "Les fournisseurs actifs et lisibles deviennent disponibles dans chaque sélecteur associé.",
          )}
          rows={suppliers.data ?? []}
          fields={["code", "supplierType", "contactName", "phone", "status"]}
          form={fields}
          emptyTitle={copy(
            fr,
            "No suppliers available",
            "Aucun fournisseur disponible",
          )}
          emptyDescription={copy(
            fr,
            "Add a supplier before creating procurement records.",
            "Ajoutez un fournisseur avant de créer des enregistrements d’achat.",
          )}
          formTitle={copy(fr, "Supplier", "Fournisseur")}
          fr={fr}
        />
      </QueryState>
    </main>
  );
}
function ProcurementWorkspace({
  orgSlug,
  fr,
}: {
  orgSlug: string;
  fr: boolean;
}) {
  const user = useSessionUser();
  const client = useQueryClient();
  const requests = useRows(
    orgSlug,
    "purchase-requests",
    can(user, "procurement.read"),
  );
  const requestLines = useRows(
    orgSlug,
    "purchase-request-lines",
    can(user, "procurement.read"),
  );
  const orders = useRows(
    orgSlug,
    "purchase-orders",
    can(user, "procurement.read"),
  );
  const orderLines = useRows(
    orgSlug,
    "purchase-order-lines",
    can(user, "procurement.read"),
  );
  const receipts = useRows(orgSlug, "receipts", can(user, "procurement.read"));
  const receiptLines = useRows(
    orgSlug,
    "receipt-lines",
    can(user, "procurement.read"),
  );
  const projects = useRows(orgSlug, "projects", can(user, "projects.read"));
  const suppliers = useRows(orgSlug, "suppliers", can(user, "suppliers.read"));
  const items = useRows(
    orgSlug,
    "inventory-items",
    can(user, "inventory.items.read"),
  );
  const warehouses = useRows(
    orgSlug,
    "warehouses",
    can(user, "inventory.warehouses.read"),
  );
  const materials = useRows(orgSlug, "materials", can(user, "projects.read"));
  const [kind, setKind] = useState<
    | "request"
    | "request-line"
    | "order"
    | "order-line"
    | "receipt"
    | "receipt-line"
    | null
  >(null);
  const create = useMutation({
    mutationFn: ({
      resource,
      body,
    }: {
      resource: OwnerManagementResource;
      body: ManagementBody;
    }) => ownerManagementApi.create(orgSlug, resource, body),
    onSuccess: () => {
      setKind(null);
      void client.invalidateQueries({ queryKey: ["operations", orgSlug] });
    },
  });
  const projectOptions = selectOptions(projects.data ?? [], ["name", "code"]);
  const supplierOptions = selectOptions(
    (suppliers.data ?? []).filter((row) => text(row.status) === "active"),
    ["name", "code"],
  );
  const itemOptions = selectOptions(
    (items.data ?? []).filter((row) => row.isActive !== false),
    ["name", "code"],
  );
  const warehouseOptions = selectOptions(
    (warehouses.data ?? []).filter((row) => row.isActive !== false),
    ["name", "code"],
  );
  const requestFields: FormField[] = [
    {
      key: "requestNumber",
      label: copy(fr, "Request number", "Numéro de demande"),
      required: true,
    },
    {
      key: "projectId",
      label: copy(fr, "Project", "Projet"),
      type: "select",
      required: true,
      options: projectOptions,
      emptyLabel: copy(fr, "No projects available", "Aucun projet disponible"),
    },
    {
      key: "supplierId",
      label: copy(fr, "Supplier if known", "Fournisseur si connu"),
      type: "select",
      options: supplierOptions,
      emptyLabel: copy(
        fr,
        "No suppliers available",
        "Aucun fournisseur disponible",
      ),
    },
    {
      key: "requestDate",
      label: copy(fr, "Request date", "Date de demande"),
      type: "date",
      defaultValue: today(),
    },
    {
      key: "requiredDate",
      label: copy(fr, "Required date", "Date nécessaire"),
      type: "date",
    },
    {
      key: "priority",
      label: copy(fr, "Priority", "Priorité"),
      type: "select",
      defaultValue: "medium",
      required: true,
      options: ["low", "medium", "high", "critical"].map((value) => ({
        value,
        label: nice(value),
      })),
    },
    {
      key: "reason",
      label: copy(fr, "Business reason", "Motif"),
      type: "textarea",
      required: true,
    },
    {
      key: "currencyCode",
      label: copy(fr, "Currency", "Devise"),
      type: "select",
      required: true,
      defaultValue: "CDF",
      options: [
        { value: "CDF", label: "CDF" },
        { value: "USD", label: "USD" },
        { value: "EUR", label: "EUR" },
      ],
    },
    { key: "notes", label: copy(fr, "Notes", "Notes"), type: "textarea" },
  ];
  const requestLineFields: FormField[] = [
    {
      key: "purchaseRequestId",
      label: copy(fr, "Purchase request", "Demande d’achat"),
      type: "select",
      required: true,
      options: selectOptions(requests.data ?? [], ["requestNumber"]),
      emptyLabel: copy(
        fr,
        "No purchase requests available",
        "Aucune demande disponible",
      ),
    },
    {
      key: "projectMaterialId",
      label: copy(fr, "Project material", "Matériau de projet"),
      type: "select",
      options: selectOptions(materials.data ?? [], ["name", "code"]),
      emptyLabel: copy(
        fr,
        "No project materials available",
        "Aucun matériau disponible",
      ),
    },
    {
      key: "inventoryItemId",
      label: copy(fr, "Inventory item", "Article de stock"),
      type: "select",
      options: itemOptions,
      emptyLabel: copy(
        fr,
        "No inventory items available",
        "Aucun article disponible",
      ),
    },
    {
      key: "description",
      label: copy(fr, "Item / service", "Article / service"),
      required: true,
    },
    {
      key: "itemKind",
      label: copy(fr, "Kind", "Nature"),
      type: "select",
      defaultValue: "material",
      required: true,
      options: ["material", "inventory", "asset", "service", "other"].map(
        (value) => ({ value, label: nice(value) }),
      ),
    },
    {
      key: "unit",
      label: copy(fr, "Unit", "Unité"),
      required: true,
      defaultValue: "unit",
    },
    {
      key: "requestedQuantity",
      label: copy(fr, "Requested quantity", "Quantité demandée"),
      type: "number",
      required: true,
      step: "0.001",
    },
    {
      key: "estimatedUnitCost",
      label: copy(fr, "Estimated unit cost", "Coût unitaire estimé"),
      type: "number",
      step: "0.01",
    },
  ];
  const orderFields: FormField[] = [
    {
      key: "orderNumber",
      label: copy(fr, "Purchase order number", "Numéro du bon de commande"),
      required: true,
    },
    {
      key: "projectId",
      label: copy(fr, "Project", "Projet"),
      type: "select",
      required: true,
      options: projectOptions,
      emptyLabel: copy(fr, "No projects available", "Aucun projet disponible"),
    },
    {
      key: "purchaseRequestId",
      label: copy(fr, "Approved request", "Demande approuvée"),
      type: "select",
      options: selectOptions(requests.data ?? [], ["requestNumber"]),
      emptyLabel: copy(
        fr,
        "No purchase requests available",
        "Aucune demande disponible",
      ),
    },
    {
      key: "supplierId",
      label: copy(fr, "Supplier", "Fournisseur"),
      type: "select",
      required: true,
      options: supplierOptions,
      emptyLabel: copy(
        fr,
        "No suppliers available",
        "Aucun fournisseur disponible",
      ),
    },
    {
      key: "warehouseId",
      label: copy(fr, "Receiving warehouse", "Entrepôt de réception"),
      type: "select",
      options: warehouseOptions,
      emptyLabel: copy(
        fr,
        "No storage locations available",
        "Aucun emplacement disponible",
      ),
    },
    {
      key: "orderDate",
      label: copy(fr, "Order date", "Date de commande"),
      type: "date",
      defaultValue: today(),
    },
    {
      key: "expectedDeliveryDate",
      label: copy(fr, "Expected delivery", "Livraison prévue"),
      type: "date",
    },
    {
      key: "currencyCode",
      label: copy(fr, "Currency", "Devise"),
      type: "select",
      defaultValue: "CDF",
      required: true,
      options: [
        { value: "CDF", label: "CDF" },
        { value: "USD", label: "USD" },
        { value: "EUR", label: "EUR" },
      ],
    },
  ];
  const orderLineFields: FormField[] = [
    {
      key: "purchaseOrderId",
      label: copy(fr, "Purchase order", "Bon de commande"),
      type: "select",
      required: true,
      options: selectOptions(orders.data ?? [], ["orderNumber"]),
      emptyLabel: copy(
        fr,
        "No purchase orders available",
        "Aucun bon disponible",
      ),
    },
    {
      key: "inventoryItemId",
      label: copy(fr, "Inventory item", "Article de stock"),
      type: "select",
      options: itemOptions,
      emptyLabel: copy(
        fr,
        "No inventory items available",
        "Aucun article disponible",
      ),
    },
    {
      key: "description",
      label: copy(fr, "Item / service", "Article / service"),
      required: true,
    },
    {
      key: "itemKind",
      label: copy(fr, "Kind", "Nature"),
      type: "select",
      defaultValue: "material",
      required: true,
      options: ["material", "inventory", "asset", "service", "other"].map(
        (value) => ({ value, label: nice(value) }),
      ),
    },
    {
      key: "unit",
      label: copy(fr, "Unit", "Unité"),
      required: true,
      defaultValue: "unit",
    },
    {
      key: "orderedQuantity",
      label: copy(fr, "Ordered quantity", "Quantité commandée"),
      type: "number",
      required: true,
      step: "0.001",
    },
    {
      key: "unitCost",
      label: copy(fr, "Unit cost", "Coût unitaire"),
      type: "number",
      required: true,
      step: "0.01",
    },
    {
      key: "taxAmount",
      label: copy(fr, "Tax / fees", "Taxes / frais"),
      type: "number",
      defaultValue: 0,
      step: "0.01",
    },
  ];
  const receiptFields: FormField[] = [
    {
      key: "receiptNumber",
      label: copy(fr, "Receipt number", "Numéro de réception"),
      required: true,
    },
    {
      key: "purchaseOrderId",
      label: copy(fr, "Purchase order", "Bon de commande"),
      type: "select",
      required: true,
      options: selectOptions(orders.data ?? [], ["orderNumber"]),
      emptyLabel: copy(
        fr,
        "No purchase orders available",
        "Aucun bon disponible",
      ),
    },
    {
      key: "warehouseId",
      label: copy(fr, "Warehouse", "Entrepôt"),
      type: "select",
      options: warehouseOptions,
      emptyLabel: copy(
        fr,
        "No storage locations available",
        "Aucun emplacement disponible",
      ),
    },
    {
      key: "receivedDate",
      label: copy(fr, "Received date", "Date de réception"),
      type: "date",
      defaultValue: today(),
    },
    {
      key: "deliveryNoteNumber",
      label: copy(fr, "Delivery note", "Bon de livraison"),
    },
  ];
  const receiptLineFields: FormField[] = [
    {
      key: "receiptId",
      label: copy(fr, "Receipt", "Réception"),
      type: "select",
      required: true,
      options: selectOptions(receipts.data ?? [], ["receiptNumber"]),
      emptyLabel: copy(
        fr,
        "No receipts available",
        "Aucune réception disponible",
      ),
    },
    {
      key: "purchaseOrderLineId",
      label: copy(fr, "Purchase order line", "Ligne de commande"),
      type: "select",
      required: true,
      options: selectOptions(orderLines.data ?? [], ["description"]),
      emptyLabel: copy(
        fr,
        "No order lines available",
        "Aucune ligne disponible",
      ),
    },
    {
      key: "inventoryItemId",
      label: copy(fr, "Inventory item", "Article de stock"),
      type: "select",
      options: itemOptions,
      emptyLabel: copy(
        fr,
        "No inventory items available",
        "Aucun article disponible",
      ),
    },
    {
      key: "receivedQuantity",
      label: copy(fr, "Received quantity", "Quantité reçue"),
      type: "number",
      required: true,
      step: "0.001",
    },
    {
      key: "damagedQuantity",
      label: copy(fr, "Damaged", "Endommagé"),
      type: "number",
      defaultValue: 0,
      step: "0.001",
    },
    {
      key: "rejectedQuantity",
      label: copy(fr, "Rejected", "Rejeté"),
      type: "number",
      defaultValue: 0,
      step: "0.001",
    },
    {
      key: "actualUnitCost",
      label: copy(fr, "Actual unit cost", "Coût unitaire réel"),
      type: "number",
      step: "0.01",
    },
  ];
  const spec =
    kind === "request"
      ? {
          resource: "purchase-requests" as const,
          title: copy(
            fr,
            "Create purchase request",
            "Créer une demande d’achat",
          ),
          fields: requestFields,
        }
      : kind === "request-line"
        ? {
            resource: "purchase-request-lines" as const,
            title: copy(fr, "Add request line", "Ajouter une ligne de demande"),
            fields: requestLineFields,
          }
        : kind === "order"
          ? {
              resource: "purchase-orders" as const,
              title: copy(
                fr,
                "Create purchase order",
                "Créer un bon de commande",
              ),
              fields: orderFields,
            }
          : kind === "order-line"
            ? {
                resource: "purchase-order-lines" as const,
                title: copy(
                  fr,
                  "Add purchase order line",
                  "Ajouter une ligne de commande",
                ),
                fields: orderLineFields,
              }
            : kind === "receipt"
              ? {
                  resource: "receipts" as const,
                  title: copy(
                    fr,
                    "Record receiving",
                    "Enregistrer une réception",
                  ),
                  fields: receiptFields,
                }
              : kind === "receipt-line"
                ? {
                    resource: "receipt-lines" as const,
                    title: copy(
                      fr,
                      "Add received line",
                      "Ajouter une ligne reçue",
                    ),
                    fields: receiptLineFields,
                  }
                : null;
  const section = (
    title: string,
    description: string,
    rows: Row[],
    fields: string[],
    add: () => void,
    line: () => void,
    empty: string,
    count: number,
  ) => (
    <Panel
      title={title}
      description={description}
      action={
        can(user, "procurement.create") ? (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={line}>
              <Plus />
              {copy(fr, "Line", "Ligne")}
            </Button>
            <Button size="sm" onClick={add}>
              <Plus />
              {copy(fr, "Add", "Ajouter")}
            </Button>
          </div>
        ) : undefined
      }
    >
      <Rows rows={rows} fields={fields} empty={<EmptyState title={empty} />} />
      <p className="mt-4 text-xs text-ink-muted">
        {copy(fr, "Related lines", "Lignes associées")}: {count}
      </p>
    </Panel>
  );
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <Header
        icon={ShoppingCart}
        title={copy(fr, "Procurement", "Achats")}
        description={copy(
          fr,
          "Requests, supplier orders, and receiving use the same records aggregated by Project Control Centre.",
          "Les demandes, commandes fournisseurs et réceptions utilisent les mêmes enregistrements que le centre de contrôle de projet.",
        )}
        action={
          can(user, "procurement.create") ? (
            <Button onClick={() => setKind("request")}>
              <Plus />
              {copy(fr, "Purchase request", "Demande d’achat")}
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-4 md:grid-cols-3">
        <Metric
          label={copy(fr, "Purchase requests", "Demandes d’achat")}
          value={String((requests.data ?? []).length)}
        />
        <Metric
          label={copy(fr, "Purchase orders", "Bons de commande")}
          value={String((orders.data ?? []).length)}
        />
        <Metric
          label={copy(fr, "Receipts", "Réceptions")}
          value={String((receipts.data ?? []).length)}
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        {section(
          copy(fr, "Purchase requests", "Demandes d’achat"),
          copy(
            fr,
            "Start with a business need and add requested items.",
            "Commencez par un besoin puis ajoutez les articles demandés.",
          ),
          requests.data ?? [],
          ["requestNumber", "status", "approvalStatus", "requiredDate"],
          () => setKind("request"),
          () => setKind("request-line"),
          copy(fr, "No purchase requests", "Aucune demande d’achat"),
          (requestLines.data ?? []).length,
        )}
        {section(
          copy(fr, "Purchase orders", "Bons de commande"),
          copy(
            fr,
            "Create a supplier order from an approved request.",
            "Créez une commande fournisseur depuis une demande approuvée.",
          ),
          orders.data ?? [],
          ["orderNumber", "status", "expectedDeliveryDate"],
          () => setKind("order"),
          () => setKind("order-line"),
          copy(fr, "No purchase orders", "Aucun bon de commande"),
          (orderLines.data ?? []).length,
        )}
        {section(
          copy(fr, "Receiving", "Réceptions"),
          copy(
            fr,
            "Record what was actually delivered. Accepted stock becomes inventory.",
            "Enregistrez ce qui a réellement été livré. Le stock accepté devient inventaire.",
          ),
          receipts.data ?? [],
          ["receiptNumber", "status", "receivedDate"],
          () => setKind("receipt"),
          () => setKind("receipt-line"),
          copy(fr, "No receipts", "Aucune réception"),
          (receiptLines.data ?? []).length,
        )}
      </div>
      {spec ? (
        <Editor
          title={spec.title}
          subtitle={copy(fr, "Procurement", "Achats")}
          fields={spec.fields}
          pending={create.isPending}
          error={create.error}
          close={() => setKind(null)}
          save={(body) => {
            if (kind === "receipt")
              body.projectId =
                (orders.data ?? []).find(
                  (order) => text(order.id) === text(body.purchaseOrderId),
                )?.projectId ?? null;
            create.mutate({ resource: spec.resource, body });
          }}
          fr={fr}
        />
      ) : null}
    </main>
  );
}
function EquipmentWorkspace({ orgSlug, fr }: { orgSlug: string; fr: boolean }) {
  const user = useSessionUser();
  const assets = useRows(orgSlug, "assets", can(user, "equipment.read"));
  const assignments = useRows(
    orgSlug,
    "asset-assignments",
    can(user, "equipment.read"),
  );
  const movements = useRows(
    orgSlug,
    "asset-movements",
    can(user, "equipment.read"),
  );
  const usage = useRows(orgSlug, "asset-usage", can(user, "equipment.read"));
  const projects = useRows(orgSlug, "projects", can(user, "projects.read"));
  const suppliers = useRows(orgSlug, "suppliers", can(user, "suppliers.read"));
  const refs = useReferences(
    orgSlug,
    can(user, "sites.read") || can(user, "employees.read"),
  );
  const assetFields: FormField[] = [
    {
      key: "name",
      label: copy(fr, "Equipment name", "Nom de l’équipement"),
      required: true,
    },
    {
      key: "category",
      label: copy(fr, "Category", "Catégorie"),
      required: true,
    },
    {
      key: "projectId",
      label: copy(fr, "Acquired from project", "Acquis via le projet"),
      type: "select",
      options: selectOptions(projects.data ?? [], ["name", "code"]),
      emptyLabel: copy(fr, "No projects available", "Aucun projet disponible"),
    },
    {
      key: "provinceId",
      label: copy(fr, "Province", "Province"),
      type: "select",
      options: selectOptions(refs.provinces.data ?? [], ["name", "code"]),
      emptyLabel: copy(
        fr,
        "No provinces available",
        "Aucune province disponible",
      ),
    },
    {
      key: "siteId",
      label: copy(fr, "Site / farm", "Site / ferme"),
      type: "select",
      options: selectOptions(refs.sites.data ?? [], ["name", "code"]),
      emptyLabel: copy(fr, "No sites available", "Aucun site disponible"),
    },
    {
      key: "supplierId",
      label: copy(fr, "Supplier", "Fournisseur"),
      type: "select",
      options: selectOptions(suppliers.data ?? [], ["name", "code"]),
      emptyLabel: copy(
        fr,
        "No suppliers available",
        "Aucun fournisseur disponible",
      ),
    },
    { key: "brand", label: copy(fr, "Brand", "Marque") },
    { key: "model", label: copy(fr, "Model", "Modèle") },
    {
      key: "serialNumber",
      label: copy(fr, "Serial number", "Numéro de série"),
    },
    {
      key: "purchaseDate",
      label: copy(fr, "Purchase date", "Date d’achat"),
      type: "date",
    },
    {
      key: "purchasePrice",
      label: copy(fr, "Purchase cost", "Coût d’achat"),
      type: "number",
      step: "0.01",
    },
    {
      key: "currencyCode",
      label: copy(fr, "Currency", "Devise"),
      type: "select",
      defaultValue: "USD",
      required: true,
      options: [
        { value: "CDF", label: "CDF" },
        { value: "USD", label: "USD" },
        { value: "EUR", label: "EUR" },
      ],
    },
    {
      key: "condition",
      label: copy(fr, "Condition", "État"),
      type: "select",
      defaultValue: "good",
      required: true,
      options: ["new", "excellent", "good", "fair", "poor", "damaged"].map(
        (value) => ({ value, label: nice(value) }),
      ),
    },
    {
      key: "status",
      label: copy(fr, "Status", "Statut"),
      type: "select",
      defaultValue: "available",
      required: true,
      options: [
        "available",
        "assigned",
        "in_use",
        "under_maintenance",
        "out_of_service",
        "damaged",
        "retired",
        "sold",
        "lost",
      ].map((value) => ({ value, label: nice(value) })),
    },
    {
      key: "assignedMemberId",
      label: copy(fr, "Responsible person", "Responsable"),
      type: "select",
      options: memberOptions(refs.employees.data ?? []),
      emptyLabel: copy(
        fr,
        "No employees available",
        "Aucun employé disponible",
      ),
    },
    {
      key: "currentLocation",
      label: copy(fr, "Current location", "Emplacement actuel"),
    },
    { key: "notes", label: copy(fr, "Notes", "Notes"), type: "textarea" },
  ];
  const assignmentFields: FormField[] = [
    {
      key: "assetId",
      label: copy(fr, "Equipment", "Équipement"),
      type: "select",
      required: true,
      options: selectOptions(assets.data ?? [], ["name", "assetNumber"]),
      emptyLabel: copy(
        fr,
        "No equipment available",
        "Aucun équipement disponible",
      ),
    },
    {
      key: "assignedMemberId",
      label: copy(fr, "Assigned person", "Personne affectée"),
      type: "select",
      options: memberOptions(refs.employees.data ?? []),
      emptyLabel: copy(
        fr,
        "No employees available",
        "Aucun employé disponible",
      ),
    },
    {
      key: "assignedProjectId",
      label: copy(fr, "Assigned project", "Projet affecté"),
      type: "select",
      options: selectOptions(projects.data ?? [], ["name", "code"]),
      emptyLabel: copy(fr, "No projects available", "Aucun projet disponible"),
    },
    {
      key: "assignedSiteId",
      label: copy(fr, "Assigned site", "Site affecté"),
      type: "select",
      options: selectOptions(refs.sites.data ?? [], ["name", "code"]),
      emptyLabel: copy(fr, "No sites available", "Aucun site disponible"),
    },
    {
      key: "assignedAt",
      label: copy(fr, "Assigned at", "Date d’affectation"),
      type: "date",
      defaultValue: today(),
    },
    { key: "notes", label: copy(fr, "Notes", "Notes"), type: "textarea" },
  ];
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <Header
        icon={Wrench}
        title={copy(fr, "Equipment", "Équipements")}
        description={copy(
          fr,
          "Durable company assets. A project purchase becomes one real equipment record that remains linked to its project.",
          "Les actifs durables de l’entreprise. Un achat de projet devient un seul enregistrement d’équipement, qui reste lié à son projet.",
        )}
      />
      <div className="grid gap-5 xl:grid-cols-2">
        <QueryState query={assets}>
          <Resource
            orgSlug={orgSlug}
            resource="assets"
            title={copy(fr, "Equipment register", "Registre des équipements")}
            description={copy(
              fr,
              "Add tractors, generators, pumps, machines, vehicles, and tools.",
              "Ajoutez tracteurs, générateurs, pompes, machines, véhicules et outils.",
            )}
            rows={assets.data ?? []}
            fields={[
              "assetNumber",
              "category",
              "status",
              "condition",
              "purchaseDate",
            ]}
            form={assetFields}
            emptyTitle={copy(fr, "No equipment", "Aucun équipement")}
            emptyDescription={copy(
              fr,
              "Add the first company asset.",
              "Ajoutez le premier actif de l’entreprise.",
            )}
            fr={fr}
          />
        </QueryState>
        <QueryState query={assignments}>
          <Resource
            orgSlug={orgSlug}
            resource="asset-assignments"
            title={copy(fr, "Assignments", "Affectations")}
            description={copy(
              fr,
              "Assign equipment to a person, site, or project while keeping its asset history.",
              "Affectez l’équipement à une personne, un site ou un projet tout en conservant son historique.",
            )}
            rows={assignments.data ?? []}
            fields={[
              "assetId",
              "assignedMemberId",
              "assignedProjectId",
              "assignedAt",
            ]}
            form={assignmentFields}
            emptyTitle={copy(fr, "No assignments", "Aucune affectation")}
            emptyDescription={copy(
              fr,
              "Assign equipment when it is placed into use.",
              "Affectez l’équipement lorsqu’il est mis en service.",
            )}
            fr={fr}
          />
        </QueryState>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <QueryState query={movements}>
          <Panel
            title={copy(fr, "Equipment movements", "Mouvements d’équipement")}
            description={copy(
              fr,
              "Transfers remain in the asset history.",
              "Les transferts restent dans l’historique de l’actif.",
            )}
          >
            <Rows
              rows={movements.data ?? []}
              fields={["fromLocation", "toLocation", "movedAt", "reason"]}
              empty={
                <EmptyState
                  title={copy(
                    fr,
                    "No equipment movements",
                    "Aucun mouvement d’équipement",
                  )}
                />
              }
            />
          </Panel>
        </QueryState>
        <QueryState query={usage}>
          <Panel
            title={copy(fr, "Usage history", "Historique d’utilisation")}
            description={copy(
              fr,
              "Usage logs track meters, fuel, work completed, and downtime.",
              "Les journaux d’utilisation suivent les compteurs, carburant, travail et arrêt.",
            )}
          >
            <Rows
              rows={usage.data ?? []}
              fields={[
                "usageDate",
                "meterStart",
                "meterEnd",
                "fuelConsumed",
                "downtimeMinutes",
              ]}
              empty={
                <EmptyState
                  title={copy(
                    fr,
                    "No usage logs",
                    "Aucun journal d’utilisation",
                  )}
                />
              }
            />
          </Panel>
        </QueryState>
      </div>
    </main>
  );
}
function MaintenanceWorkspace({
  orgSlug,
  fr,
}: {
  orgSlug: string;
  fr: boolean;
}) {
  const user = useSessionUser();
  const assets = useRows(orgSlug, "assets", can(user, "equipment.read"));
  const plans = useRows(
    orgSlug,
    "maintenance-plans",
    can(user, "maintenance.read"),
  );
  const work = useRows(
    orgSlug,
    "maintenance-work-orders",
    can(user, "work_orders.read"),
  );
  const parts = useRows(
    orgSlug,
    "maintenance-parts",
    can(user, "maintenance.read"),
  );
  const projects = useRows(orgSlug, "projects", can(user, "projects.read"));
  const planFields: FormField[] = [
    {
      key: "assetId",
      label: copy(fr, "Equipment", "Équipement"),
      type: "select",
      required: true,
      options: selectOptions(assets.data ?? [], ["name", "assetNumber"]),
      emptyLabel: copy(
        fr,
        "No equipment available",
        "Aucun équipement disponible",
      ),
    },
    {
      key: "name",
      label: copy(fr, "Plan name", "Nom du plan"),
      required: true,
    },
    {
      key: "maintenanceType",
      label: copy(fr, "Maintenance type", "Type de maintenance"),
      type: "select",
      defaultValue: "preventive",
      required: true,
      options: [
        "preventive",
        "corrective",
        "emergency",
        "inspection",
        "routine_service",
      ].map((value) => ({ value, label: nice(value) })),
    },
    {
      key: "intervalDays",
      label: copy(fr, "Interval (days)", "Intervalle (jours)"),
      type: "number",
      hint: copy(
        fr,
        "Provide a date, meter, or interval.",
        "Indiquez une date, un compteur ou un intervalle.",
      ),
    },
    {
      key: "nextDueDate",
      label: copy(fr, "Next due date", "Prochaine échéance"),
      type: "date",
    },
    {
      key: "estimatedCost",
      label: copy(fr, "Estimated cost", "Coût estimé"),
      type: "number",
      step: "0.01",
    },
    {
      key: "isActive",
      label: copy(fr, "Active", "Actif"),
      type: "checkbox",
      defaultValue: true,
    },
    {
      key: "description",
      label: copy(fr, "Description", "Description"),
      type: "textarea",
    },
  ];
  const workFields: FormField[] = [
    {
      key: "workOrderNumber",
      label: copy(fr, "Work order number", "Numéro d’ordre de travail"),
      required: true,
    },
    {
      key: "assetId",
      label: copy(fr, "Equipment", "Équipement"),
      type: "select",
      required: true,
      options: selectOptions(assets.data ?? [], ["name", "assetNumber"]),
      emptyLabel: copy(
        fr,
        "No equipment available",
        "Aucun équipement disponible",
      ),
    },
    {
      key: "projectId",
      label: copy(fr, "Related project", "Projet lié"),
      type: "select",
      options: selectOptions(projects.data ?? [], ["name", "code"]),
      emptyLabel: copy(fr, "No projects available", "Aucun projet disponible"),
    },
    {
      key: "maintenanceType",
      label: copy(fr, "Maintenance type", "Type de maintenance"),
      type: "select",
      defaultValue: "preventive",
      required: true,
      options: [
        "preventive",
        "corrective",
        "emergency",
        "inspection",
        "routine_service",
      ].map((value) => ({ value, label: nice(value) })),
    },
    {
      key: "title",
      label: copy(fr, "Work title", "Titre du travail"),
      required: true,
    },
    {
      key: "status",
      label: copy(fr, "Status", "Statut"),
      type: "select",
      defaultValue: "reported",
      required: true,
      options: [
        "reported",
        "waiting_approval",
        "approved",
        "in_progress",
        "completed",
        "cancelled",
      ].map((value) => ({ value, label: nice(value) })),
    },
    {
      key: "priority",
      label: copy(fr, "Priority", "Priorité"),
      type: "select",
      defaultValue: "normal",
      required: true,
      options: ["low", "normal", "high", "critical"].map((value) => ({
        value,
        label: nice(value),
      })),
    },
    {
      key: "dueDate",
      label: copy(fr, "Due date", "Date d’échéance"),
      type: "date",
    },
    {
      key: "problemDescription",
      label: copy(fr, "Problem / work needed", "Problème / travail nécessaire"),
      type: "textarea",
    },
    {
      key: "laborCost",
      label: copy(fr, "Labour cost", "Coût de main-d’œuvre"),
      type: "number",
      defaultValue: 0,
      step: "0.01",
    },
    {
      key: "partsCost",
      label: copy(fr, "Parts cost", "Coût des pièces"),
      type: "number",
      defaultValue: 0,
      step: "0.01",
    },
    {
      key: "otherCost",
      label: copy(fr, "Other cost", "Autre coût"),
      type: "number",
      defaultValue: 0,
      step: "0.01",
    },
    { key: "notes", label: copy(fr, "Notes", "Notes"), type: "textarea" },
  ];
  const due =
    (plans.data ?? []).filter(
      (row) => text(row.nextDueDate) && text(row.nextDueDate) <= today(),
    ).length +
    (work.data ?? []).filter(
      (row) =>
        !["completed", "cancelled"].includes(text(row.status)) &&
        text(row.dueDate) &&
        text(row.dueDate) < today(),
    ).length;
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <Header
        icon={Settings2}
        title={copy(fr, "Maintenance", "Maintenance")}
        description={copy(
          fr,
          "Plans, repairs, and service work connect to real equipment and appear in the related project resource history.",
          "Les plans, réparations et entretiens se connectent aux équipements réels et apparaissent dans l’historique des ressources du projet.",
        )}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <Metric
          label={copy(fr, "Active plans", "Plans actifs")}
          value={String(
            (plans.data ?? []).filter((row) => row.isActive !== false).length,
          )}
        />
        <Metric
          label={copy(fr, "Open work orders", "Ordres de travail ouverts")}
          value={String(
            (work.data ?? []).filter(
              (row) => !["completed", "cancelled"].includes(text(row.status)),
            ).length,
          )}
        />
        <Metric
          label={copy(fr, "Due / overdue", "À échéance / en retard")}
          value={String(due)}
          warning={due > 0}
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <QueryState query={plans}>
          <Resource
            orgSlug={orgSlug}
            resource="maintenance-plans"
            title={copy(fr, "Maintenance schedules", "Plans de maintenance")}
            description={copy(
              fr,
              "Schedule preventive maintenance by date, meter, or interval.",
              "Planifiez l’entretien préventif par date, compteur ou intervalle.",
            )}
            rows={plans.data ?? []}
            fields={[
              "maintenanceType",
              "nextDueDate",
              "intervalDays",
              "estimatedCost",
            ]}
            form={planFields}
            emptyTitle={copy(
              fr,
              "No maintenance schedules",
              "Aucun plan de maintenance",
            )}
            emptyDescription={copy(
              fr,
              "Create a service plan for equipment that needs it.",
              "Créez un plan de service pour les équipements qui en ont besoin.",
            )}
            fr={fr}
          />
        </QueryState>
        <QueryState query={work}>
          <Resource
            orgSlug={orgSlug}
            resource="maintenance-work-orders"
            title={copy(fr, "Service & repairs", "Services et réparations")}
            description={copy(
              fr,
              "A work order is complete only after the work is confirmed.",
              "Un ordre de travail n’est terminé qu’après confirmation du travail.",
            )}
            rows={work.data ?? []}
            fields={[
              "workOrderNumber",
              "maintenanceType",
              "status",
              "dueDate",
              "laborCost",
              "partsCost",
            ]}
            form={workFields}
            emptyTitle={copy(
              fr,
              "No maintenance work orders",
              "Aucun ordre de maintenance",
            )}
            emptyDescription={copy(
              fr,
              "Report a service, inspection, breakdown, or repair.",
              "Signalez un entretien, inspection, panne ou réparation.",
            )}
            fr={fr}
          />
        </QueryState>
      </div>
      <QueryState query={parts}>
        <Panel
          title={copy(fr, "Maintenance parts", "Pièces de maintenance")}
          description={copy(
            fr,
            "Parts issued from inventory remain connected to this maintenance history.",
            "Les pièces sorties du stock restent liées à cet historique de maintenance.",
          )}
        >
          <Rows
            rows={parts.data ?? []}
            fields={["partName", "quantity", "unit", "unitCost", "issuedAt"]}
            empty={
              <EmptyState
                title={copy(
                  fr,
                  "No maintenance parts recorded",
                  "Aucune pièce de maintenance enregistrée",
                )}
              />
            }
          />
        </Panel>
      </QueryState>
    </main>
  );
}
export function OperationsArea({
  orgSlug,
  area,
}: {
  orgSlug: string;
  area: OperationsAreaKind;
}) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  if (area === "tasks") return <TasksWorkspace orgSlug={orgSlug} fr={fr} />;
  if (area === "inventory")
    return <InventoryWorkspace orgSlug={orgSlug} fr={fr} />;
  if (area === "suppliers")
    return <SuppliersWorkspace orgSlug={orgSlug} fr={fr} />;
  if (area === "procurement")
    return <ProcurementWorkspace orgSlug={orgSlug} fr={fr} />;
  if (area === "equipment")
    return <EquipmentWorkspace orgSlug={orgSlug} fr={fr} />;
  return <MaintenanceWorkspace orgSlug={orgSlug} fr={fr} />;
}
