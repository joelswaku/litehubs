"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Download,
  FileLock2,
  FileText,
  FolderOpen,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { ApiError, orgApiUrl } from "@/lib/api";
import {
  companySetupApi,
  type OrganizationSite,
  type Province,
} from "@/lib/company-setup-api";
import { documentsApi } from "@/lib/documents-api";
import { can, isOwner } from "@/lib/permissions";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";

type DocumentRow = Record<string, unknown> & { id: string };
const copy = (fr: boolean, en: string, french: string) => (fr ? french : en);
const text = (value: unknown) => String(value ?? "").trim();
const title = (value: unknown) =>
  text(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "—";
const size = (value: unknown) => {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
const date = (value: unknown, locale: string) =>
  value
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
        new Date(String(value)),
      )
    : "—";
const optional = (value: FormDataEntryValue | null) => text(value) || undefined;
const categories = [
  "general",
  "contract",
  "permit",
  "licence",
  "insurance",
  "certificate",
  "invoice",
  "receipt",
  "report",
  "policy",
  "employee",
  "legal",
  "statement",
];
function Select({
  name,
  value,
  onChange,
  children,
}: {
  name: string;
  value: string;
  onChange?: (next: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      name={name}
      value={onChange ? value : undefined}
      defaultValue={onChange ? undefined : value}
      onChange={(event) => onChange?.(event.target.value)}
      className="h-10 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
    >
      {children}
    </select>
  );
}
export function DocumentsArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const user = useSessionUser();
  const [category, setCategory] = useState("all");
  const [editor, setEditor] = useState<DocumentRow | "new" | null>(null);
  const queryClient = useQueryClient();
  const documents = useQuery({
    queryKey: ["company-documents", orgSlug, category],
    queryFn: () =>
      documentsApi.list<{ documents: DocumentRow[] }>(
        orgSlug,
        category === "all" ? undefined : { category },
      ),
    select: (data) => data.documents,
  });
  const summary = useQuery({
    queryKey: ["company-documents-summary", orgSlug],
    queryFn: () =>
      documentsApi.summary<{
        metrics: {
          total: number;
          confidential: number;
          expiring: number;
          contracts: number;
        };
      }>(orgSlug),
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
  const remove = useMutation({
    mutationFn: (id: string) => documentsApi.remove(orgSlug, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["company-documents", orgSlug],
      });
      void queryClient.invalidateQueries({
        queryKey: ["company-documents-summary", orgSlug],
      });
    },
  });
  const grouped = useMemo(() => {
    const map = new Map<string, DocumentRow[]>();
    for (const document of documents.data ?? []) {
      const key = text(document.category) || "general";
      map.set(key, [...(map.get(key) ?? []), document]);
    }
    return map;
  }, [documents.data]);
  if (documents.isPending)
    return (
      <main className="p-6">
        <Skeleton className="h-96" />
      </main>
    );
  if (documents.isError)
    return (
      <ErrorState
        description={(documents.error as ApiError).message}
        onRetry={() => void documents.refetch()}
      />
    );
  const metrics = summary.data?.metrics ?? {
    total: 0,
    confidential: 0,
    expiring: 0,
    contracts: 0,
  };
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <header className="overflow-hidden rounded-3xl border border-border bg-[linear-gradient(120deg,#312e81,#4338ca_55%,#7c3aed)] p-6 text-white shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
              <FileLock2 className="size-3.5" />
              {copy(
                fr,
                "Private company library",
                "Bibliothèque privée de l’entreprise",
              )}
            </span>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight">
              {copy(fr, "Documents", "Documents")}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-violet-50">
              {copy(
                fr,
                "Store permits, contracts, receipts, policies and evidence in one access-controlled company library.",
                "Conservez permis, contrats, reçus, politiques et preuves dans une bibliothèque d’entreprise contrôlée.",
              )}
            </p>
          </div>
          {can(user, "documents.create") ? (
            <Button
              className="bg-white text-indigo-900 hover:bg-indigo-50"
              onClick={() => setEditor("new")}
            >
              <Upload />
              {copy(fr, "Upload document", "Ajouter un document")}
            </Button>
          ) : null}
        </div>
      </header>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            en: "Total",
            count: metrics.total,
            french: "Tous les documents",
            Icon: FolderOpen,
          },
          {
            en: "Confidential",
            count: metrics.confidential,
            french: "Confidentiels",
            Icon: FileLock2,
          },
          {
            en: "Expiring soon",
            count: metrics.expiring,
            french: "Échéance proche",
            Icon: Archive,
          },
          {
            en: "Contracts",
            count: metrics.contracts,
            french: "Contrats",
            Icon: FileText,
          },
        ].map(({ en, count, french, Icon: CardIcon }) => (
          <div
            key={en}
            className="rounded-2xl border border-border bg-surface-1 p-4 shadow-sm"
          >
            <CardIcon className="size-4 text-brand" />
            <p className="mt-3 text-xs font-semibold text-ink-muted">
              {copy(fr, en, french)}
            </p>
            <p className="mt-1 text-3xl font-semibold text-ink">{count}</p>
          </div>
        ))}
      </section>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_25rem]">
        <section className="overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
            <div>
              <h2 className="font-semibold text-ink">
                {copy(fr, "Company library", "Bibliothèque de l’entreprise")}
              </h2>
              <p className="mt-1 text-xs text-ink-secondary">
                {copy(
                  fr,
                  "Files are private by default and are always checked before preview or download.",
                  "Les fichiers restent privés par défaut et sont toujours vérifiés avant aperçu ou téléchargement.",
                )}
              </p>
            </div>
            <Select name="category" value={category} onChange={setCategory}>
              <option value="all">
                {copy(fr, "All folders", "Tous les dossiers")}
              </option>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {title(item)}
                </option>
              ))}
            </Select>
          </div>
          {grouped.size ? (
            <div className="divide-y divide-border">
              {[...grouped.entries()].map(([folder, items]) => (
                <section key={folder} className="p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <FolderOpen className="size-4 text-brand" />
                    <h3 className="text-sm font-semibold text-ink">
                      {title(folder)}
                    </h3>
                    <Badge variant="outline" icon={false}>
                      {items.length}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    {items.map((document) => (
                      <article
                        key={document.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-2/60 p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-semibold text-ink">
                              {String(document.title)}
                            </p>
                            {document.isConfidential ? (
                              <Badge variant="warning" icon={false}>
                                <FileLock2 className="size-3" />
                                {copy(fr, "Confidential", "Confidentiel")}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-1 truncate text-xs text-ink-secondary">
                            {String(document.fileName)} ·{" "}
                            {String(document.mimeType)} ·{" "}
                            {size(document.sizeBytes)}
                          </p>
                          <p className="mt-1 text-xs text-ink-muted">
                            {copy(fr, "Added", "Ajouté")}{" "}
                            {date(document.createdAt, locale)}
                            {document.uploadedByName
                              ? ` · ${String(document.uploadedByName)}`
                              : ""}
                            {document.expiresOn
                              ? ` · ${copy(fr, "Expires", "Expire")} ${date(document.expiresOn, locale)}`
                              : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <a
                            href={orgApiUrl(
                              orgSlug,
                              `documents/${document.id}/preview`,
                            )}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Button size="sm" variant="secondary">
                              {copy(fr, "Preview", "Aperçu")}
                            </Button>
                          </a>
                          <a
                            href={orgApiUrl(
                              orgSlug,
                              `documents/${document.id}/download`,
                            )}
                          >
                            <Button size="sm" variant="secondary">
                              <Download />
                              {copy(fr, "Download", "Télécharger")}
                            </Button>
                          </a>
                          {can(user, "documents.update") ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setEditor(document)}
                            >
                              <Pencil />
                              {copy(fr, "Edit", "Modifier")}
                            </Button>
                          ) : null}
                          {can(user, "documents.delete") ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              loading={remove.isPending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    copy(
                                      fr,
                                      "Delete this document permanently?",
                                      "Supprimer définitivement ce document ?",
                                    ),
                                  )
                                )
                                  remove.mutate(document.id);
                              }}
                            >
                              <Trash2 className="text-critical" />
                            </Button>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={FileText}
              title={copy(
                fr,
                "No documents yet",
                "Aucun document pour le moment",
              )}
              description={copy(
                fr,
                "Upload the first contract, permit, receipt, policy, report, or evidence file.",
                "Ajoutez le premier contrat, permis, reçu, politique, rapport ou fichier de preuve.",
              )}
            />
          )}
        </section>
        <aside className="xl:sticky xl:top-6 xl:self-start">
          {editor ? (
            <DocumentEditor
              orgSlug={orgSlug}
              row={editor}
              provinces={provinces.data ?? []}
              sites={sites.data ?? []}
              onClose={() => setEditor(null)}
            />
          ) : (
            <section className="rounded-2xl border border-dashed border-border bg-surface-2 p-5">
              <ShieldCheck className="size-6 text-brand" />
              <h2 className="mt-4 font-semibold text-ink">
                {copy(fr, "Document controls", "Contrôles des documents")}
              </h2>
              <p className="mt-2 text-sm leading-6 text-ink-secondary">
                {copy(
                  fr,
                  "Use a category and an expiry date so the owner can find and renew important evidence before it expires.",
                  "Utilisez une catégorie et une date d’expiration afin que le propriétaire trouve et renouvelle les pièces importantes avant leur échéance.",
                )}
              </p>
              <ul className="mt-4 space-y-2 text-xs text-ink-secondary">
                <li>
                  •{" "}
                  {copy(
                    fr,
                    "PDF, Word, Excel, CSV, text and image files",
                    "PDF, Word, Excel, CSV, texte et images",
                  )}
                </li>
                <li>
                  •{" "}
                  {copy(
                    fr,
                    "Company, province and site scope",
                    "Périmètre entreprise, province et site",
                  )}
                </li>
                <li>
                  •{" "}
                  {copy(
                    fr,
                    "Owner-only confidential documents",
                    "Documents confidentiels réservés au propriétaire",
                  )}
                </li>
              </ul>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
function DocumentEditor({
  orgSlug,
  row,
  provinces,
  sites,
  onClose,
}: {
  orgSlug: string;
  row: DocumentRow | "new";
  provinces: Province[];
  sites: OrganizationSite[];
  onClose: () => void;
}) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const user = useSessionUser();
  const queryClient = useQueryClient();
  const current = row === "new" ? null : row;
  const isNew = row === "new";
  const [provinceId, setProvinceId] = useState(text(current?.provinceId));
  const [siteId, setSiteId] = useState(text(current?.siteId));
  const save = useMutation({
    mutationFn: async (form: FormData) =>
      isNew
        ? documentsApi.upload<{ document: DocumentRow }>(orgSlug, form)
        : documentsApi.update<{ document: DocumentRow }>(
            orgSlug,
            current!.id,
            Object.fromEntries(form.entries()),
          ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["company-documents", orgSlug],
      });
      void queryClient.invalidateQueries({
        queryKey: ["company-documents-summary", orgSlug],
      });
      onClose();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.set("provinceId", provinceId);
    form.set("siteId", siteId);
    if (!isNew) {
      form.delete("file");
      form.set(
        "isConfidential",
        form.get("isConfidential") === "on" ? "true" : "false",
      );
    }
    save.mutate(form);
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
            "Could not save this document.",
            "Impossible d’enregistrer ce document.",
          )
        : null;
  return (
    <section className="rounded-2xl border border-border bg-surface-1 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-ink">
            {isNew
              ? copy(fr, "Upload document", "Ajouter un document")
              : copy(fr, "Edit document", "Modifier le document")}
          </h2>
          <p className="mt-1 text-xs leading-5 text-ink-secondary">
            {copy(
              fr,
              "The file is stored privately and never exposed through a public link.",
              "Le fichier est stocké en privé et n’est jamais exposé par un lien public.",
            )}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          <X />
        </Button>
      </div>
      <form className="mt-5 grid gap-3" onSubmit={submit}>
        <Field label={copy(fr, "Title", "Titre")} required>
          <Input name="title" required defaultValue={text(current?.title)} />
        </Field>
        {isNew ? (
          <Field label={copy(fr, "File", "Fichier")} required>
            <Input
              name="file"
              type="file"
              required
              accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,image/jpeg,image/png,image/webp"
            />
          </Field>
        ) : (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-secondary">
            {copy(fr, "Stored file", "Fichier enregistré")}:{" "}
            <strong className="text-ink">{String(current?.fileName)}</strong>
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={copy(fr, "Folder", "Dossier")}>
            <Select
              name="category"
              value={text(current?.category) || "general"}
            >
              {categories.map((item) => (
                <option key={item} value={item}>
                  {title(item)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={copy(fr, "Expires on", "Expire le")}>
            <Input
              name="expiresOn"
              type="date"
              defaultValue={text(current?.expiresOn).slice(0, 10)}
            />
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
                {copy(fr, "Company-wide", "Toute l’entreprise")}
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
              <option value="">
                {copy(fr, "Not site-specific", "Non spécifique à un site")}
              </option>
              {scopedSites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={copy(fr, "Description", "Description")}>
          <Textarea
            name="description"
            rows={3}
            defaultValue={text(current?.description)}
          />
        </Field>
        {isOwner(user) ? (
          <label className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-ink">
            <input
              name="isConfidential"
              type="checkbox"
              defaultChecked={current?.isConfidential === true}
              className="size-4 accent-[var(--brand)]"
            />
            {copy(
              fr,
              "Confidential — only the Owner can open this document",
              "Confidentiel — seul le propriétaire peut ouvrir ce document",
            )}
          </label>
        ) : null}
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
            <Upload />
            {isNew
              ? copy(fr, "Upload", "Ajouter")
              : copy(fr, "Save changes", "Enregistrer les modifications")}
          </Button>
        </div>
      </form>
    </section>
  );
}
