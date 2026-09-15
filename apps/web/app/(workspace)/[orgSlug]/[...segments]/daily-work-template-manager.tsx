"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Pencil, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { ApiError, get, orgUrl } from "@/lib/api";
import { dailyWorkApi } from "@/lib/daily-work-api";
import { can } from "@/lib/permissions";
import { useSessionUser } from "@/stores/session-store";

type Site = { id: string; name: string };
type Item = {
  id: string;
  position: number;
  prompt: string;
  responseType: "boolean" | "number" | "text" | "choice" | "photo";
  unit?: string | null;
  isRequired: boolean;
  guidance?: string | null;
};
type Template = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  domain: string;
  frequency: string;
  siteId?: string | null;
  siteName?: string | null;
  isActive?: boolean;
  itemCount: number | string;
  items?: Item[];
};
type Dialog =
  | { kind: "template"; item?: Template }
  | { kind: "item"; template: Template; item?: Item }
  | null;
const domains = [
  "general",
  "poultry",
  "pigs",
  "agriculture",
  "security",
  "maintenance",
  "biosecurity",
  "safety",
  "hygiene",
  "inventory",
];
const frequencies = ["per_shift", "daily", "weekly", "monthly", "ad_hoc"];
const responseTypes = ["boolean", "number", "text", "choice", "photo"];
const readable = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const text = (form: FormData, key: string) =>
  String(form.get(key) ?? "").trim();
const optional = (form: FormData, key: string) => text(form, key) || null;
const number = (form: FormData, key: string, fallback = 1) => {
  const value = Number(text(form, key));
  return Number.isFinite(value) ? value : fallback;
};
const errorText = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : "The change could not be completed.";

export function DailyWorkTemplateManager({
  orgSlug,
  onClose,
}: {
  orgSlug: string;
  onClose: () => void;
}) {
  const user = useSessionUser();
  const client = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const templates = useQuery({
    queryKey: ["daily-work-templates", orgSlug],
    queryFn: () =>
      dailyWorkApi.templates
        .list<{ templates: Template[] }>(orgSlug, { limit: 200 })
        .then((data) => (Array.isArray(data.templates) ? data.templates : [])),
    enabled: can(user, "daily_operations.read"),
  });
  const sites = useQuery({
    queryKey: ["daily-work-sites", orgSlug],
    queryFn: () =>
      get<{ sites: Site[] }>(orgUrl(orgSlug, "sites")).then((data) =>
        Array.isArray(data.sites) ? data.sites : [],
      ),
    enabled: can(user, "sites.read"),
  });
  const refresh = () =>
    client.invalidateQueries({ queryKey: ["daily-work-templates", orgSlug] });
  const templateSave = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      dailyWorkApi.templates.update(orgSlug, id, body),
    onSuccess: () => {
      setDialog(null);
      refresh();
    },
  });
  const templateDelete = useMutation({
    mutationFn: (id: string) => dailyWorkApi.templates.remove(orgSlug, id),
    onSuccess: refresh,
  });
  const itemSave = useMutation({
    mutationFn: ({
      template,
      id,
      body,
    }: {
      template: Template;
      id?: string;
      body: Record<string, unknown>;
    }) =>
      id
        ? dailyWorkApi.templates.items.update(orgSlug, template.id, id, body)
        : dailyWorkApi.templates.items.create(orgSlug, template.id, body),
    onSuccess: () => {
      setDialog(null);
      refresh();
    },
  });
  const itemDelete = useMutation({
    mutationFn: ({
      templateId,
      itemId,
    }: {
      templateId: string;
      itemId: string;
    }) => dailyWorkApi.templates.items.remove(orgSlug, templateId, itemId),
    onSuccess: refresh,
  });
  const error = [
    templateSave.error,
    templateDelete.error,
    itemSave.error,
    itemDelete.error,
  ].find(Boolean);
  const canEdit = can(user, "daily_operations.update"),
    canDelete = can(user, "daily_operations.delete"),
    canCreate = can(user, "daily_operations.create");
  return (
    <section className="rounded-2xl border border-border bg-surface-1 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-brand">
            Checklist administration
          </p>
          <h2 className="mt-1 text-lg font-semibold text-ink">
            Manage checklist templates
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-secondary">
            Change a template or its checks here. Existing checklist runs keep
            their recorded answers.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          <X />
          Close
        </Button>
      </div>
      {error ? (
        <p className="mt-4 rounded-lg border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical">
          {errorText(error)}
        </p>
      ) : null}
      {templates.isPending ? (
        <Skeleton className="mt-5 h-64" />
      ) : templates.isError ? (
        <ErrorState
          title="Could not load templates"
          description={errorText(templates.error)}
          onRetry={() => templates.refetch()}
        />
      ) : templates.data?.length ? (
        <div className="mt-5 space-y-4">
          {templates.data.map((template) => (
            <article
              key={template.id}
              className="rounded-xl border border-border p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">
                    {template.name}
                  </p>
                  <p className="mt-1 text-xs text-ink-secondary">
                    {template.code} · {readable(template.domain)} ·{" "}
                    {template.siteName ?? "All eligible sites"}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Badge
                    variant={template.isActive === false ? "neutral" : "good"}
                  >
                    {template.isActive === false ? "Inactive" : "Active"}
                  </Badge>
                  {canEdit ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setDialog({ kind: "template", item: template })
                      }
                    >
                      <Pencil />
                      Edit
                    </Button>
                  ) : null}
                  {canDelete ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={templateDelete.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete ${template.name}? Templates with recorded runs cannot be deleted.`,
                          )
                        )
                          templateDelete.mutate(template.id);
                      }}
                    >
                      <Trash2 />
                      Delete
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="mt-4 rounded-lg bg-surface-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[.1em] text-ink-secondary">
                    Checklist checks · {template.itemCount}
                  </p>
                  {canCreate ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setDialog({ kind: "item", template })}
                    >
                      <Plus />
                      Add check
                    </Button>
                  ) : null}
                </div>
                {template.items?.length ? (
                  <div className="mt-3 space-y-2">
                    {template.items.map((item) => (
                      <div
                        key={item.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-1 px-3 py-2"
                      >
                        <div>
                          <p className="text-sm text-ink">
                            {item.position}. {item.prompt}
                          </p>
                          <p className="mt-1 text-xs text-ink-secondary">
                            {readable(item.responseType)}
                            {item.isRequired ? " · Required" : " · Optional"}
                          </p>
                        </div>
                        {canEdit || canDelete ? (
                          <div className="flex gap-1">
                            {canEdit ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  setDialog({ kind: "item", template, item })
                                }
                              >
                                <Pencil />
                                Edit
                              </Button>
                            ) : null}
                            {canDelete ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={itemDelete.isPending}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      "Delete this checklist check?",
                                    )
                                  )
                                    itemDelete.mutate({
                                      templateId: template.id,
                                      itemId: item.id,
                                    });
                                }}
                              >
                                <Trash2 />
                                Delete
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-ink-secondary">
                    No checklist checks configured yet.
                  </p>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No checklist templates available."
          description="Create a checklist first, then come back here to manage its checks."
          icon={ClipboardList}
        />
      )}
      {dialog ? (
        <DialogBox
          title={
            dialog.kind === "template"
              ? `Edit ${dialog.item!.name}`
              : dialog.item
                ? "Edit checklist check"
                : "Add checklist check"
          }
          onClose={() => setDialog(null)}
        >
          {dialog.kind === "template" ? (
            <TemplateForm
              item={dialog.item!}
              sites={sites.data ?? []}
              busy={templateSave.isPending}
              onSubmit={(body) =>
                templateSave.mutate({ id: dialog.item!.id, body })
              }
            />
          ) : (
            <ItemForm
              item={dialog.item}
              template={dialog.template}
              busy={itemSave.isPending}
              onSubmit={(body) =>
                itemSave.mutate({
                  template: dialog.template,
                  id: dialog.item?.id,
                  body,
                })
              }
            />
          )}
        </DialogBox>
      ) : null}
    </section>
  );
}

function DialogBox({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <section className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-surface-1 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-xl font-semibold text-ink">{title}</h3>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X />
            Close
          </Button>
        </div>
        {children}
      </section>
    </div>
  );
}
function TemplateForm({
  item,
  sites,
  busy,
  onSubmit,
}: {
  item: Template;
  sites: Site[];
  busy: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({
      code: text(form, "code"),
      name: text(form, "name"),
      description: optional(form, "description"),
      domain: text(form, "domain"),
      frequency: text(form, "frequency"),
      siteId: text(form, "siteId") || null,
      isActive: form.get("isActive") === "on",
    });
  }
  return (
    <form className="mt-5" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" htmlFor="manage-template-code" required>
          <Input name="code" defaultValue={item.code} required />
        </Field>
        <Field label="Name" htmlFor="manage-template-name" required>
          <Input name="name" defaultValue={item.name} required />
        </Field>
        <Field label="Domain" htmlFor="manage-template-domain">
          <select
            name="domain"
            defaultValue={item.domain}
            className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
          >
            {domains.map((domain) => (
              <option value={domain} key={domain}>
                {readable(domain)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Frequency" htmlFor="manage-template-frequency">
          <select
            name="frequency"
            defaultValue={item.frequency}
            className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
          >
            {frequencies.map((frequency) => (
              <option value={frequency} key={frequency}>
                {readable(frequency)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Site" htmlFor="manage-template-site">
          <select
            name="siteId"
            defaultValue={item.siteId ?? ""}
            className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
          >
            <option value="">All eligible sites</option>
            {sites.map((site) => (
              <option value={site.id} key={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm text-ink-secondary">
        <input
          name="isActive"
          type="checkbox"
          defaultChecked={item.isActive ?? true}
        />
        Template is active
      </label>
      <Field
        label="Description"
        htmlFor="manage-template-description"
        className="mt-4"
      >
        <Textarea name="description" defaultValue={item.description ?? ""} />
      </Field>
      <div className="mt-6 flex justify-end">
        <Button type="submit" loading={busy}>
          Save template
        </Button>
      </div>
    </form>
  );
}
function ItemForm({
  item,
  template,
  busy,
  onSubmit,
}: {
  item?: Item;
  template: Template;
  busy: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({
      position: number(form, "position", Number(template.itemCount || 0) + 1),
      prompt: text(form, "prompt"),
      responseType: text(form, "responseType"),
      unit: optional(form, "unit"),
      isRequired: form.get("isRequired") === "on",
      guidance: optional(form, "guidance"),
    });
  }
  return (
    <form className="mt-5" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Position" htmlFor="manage-item-position" required>
          <Input
            name="position"
            type="number"
            min="1"
            step="1"
            defaultValue={item?.position ?? Number(template.itemCount || 0) + 1}
            required
          />
        </Field>
        <Field label="Response type" htmlFor="manage-item-response">
          <select
            name="responseType"
            defaultValue={item?.responseType ?? "boolean"}
            className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
          >
            {responseTypes.map((type) => (
              <option value={type} key={type}>
                {readable(type)}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Check"
          htmlFor="manage-item-prompt"
          required
          className="sm:col-span-2"
        >
          <Input name="prompt" defaultValue={item?.prompt} required />
        </Field>
        <Field label="Unit" htmlFor="manage-item-unit">
          <Input
            name="unit"
            defaultValue={item?.unit ?? ""}
            placeholder="Optional, e.g. kg or °C"
          />
        </Field>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm text-ink-secondary">
        <input
          name="isRequired"
          type="checkbox"
          defaultChecked={item?.isRequired ?? true}
        />
        Required check
      </label>
      <Field label="Guidance" htmlFor="manage-item-guidance" className="mt-4">
        <Textarea name="guidance" defaultValue={item?.guidance ?? ""} />
      </Field>
      <div className="mt-6 flex justify-end">
        <Button type="submit" loading={busy}>
          Save check
        </Button>
      </div>
    </form>
  );
}
