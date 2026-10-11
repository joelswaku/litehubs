"use client";

import { useMemo, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CalendarClock, CheckCircle2, Download, FileSignature, FolderOpen, MapPin, PenLine, Pencil, Plus, ReceiptText, Send, ShieldCheck, Type, Upload, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, NoAccessState, SkeletonCard } from "@/components/ui/states";
import { ApiError, get, orgApiUrl, orgUrl, patch, post } from "@/lib/api";
import { companySetupApi, type OrganizationRole } from "@/lib/company-setup-api";
import { can, hasRole, isOwner } from "@/lib/permissions";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";
import { ContractPaper } from "@/components/contracts/contract-paper";
import { READY_CONTRACT_TEMPLATES, type ReadyContractTemplate } from "@/components/contracts/ready-contract-templates";

type ContractStatus = "draft" | "pending_signature" | "ready_for_signature" | "awaiting_employee_signature" | "awaiting_employer_signature" | "signed" | "active" | "rejected" | "expired" | "terminated" | "renewed" | "cancelled";
type Contract = {
  id: string;
  reference: string;
  title: string;
  contractType: string;
  counterparty: { type: string; id: string | null; name: string | null };
  startsOn: string;
  endsOn: string | null;
  signedOn: string | null;
  terminatedOn: string | null;
  terminationReason: string | null;
  autoRenews: boolean;
  renewalNoticeDays: number | null;
  currency: string | null;
  contractValue: number | null;
  paymentTerms: string | null;
  employerSignerRole: string | null;
  status: ContractStatus;
  province: { id: string; name: string | null } | null;
  document: { id: string; title: string | null } | null;
  ownerName: string | null;
  notes: string | null;
  updatedAt: string;
};
type Employee = { id: string; fullName: string; employeeNumber: string };
type DocumentItem = { id: string; title: string; category: string; subjectTable?: string | null; mimeType?: string | null; fileName?: string | null; createdAt?: string };
const WORD_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
/** Contracts uploaded by the company (PDF or Word), never the PDFs LiteHubs generates. */
const importedContracts = (documents: DocumentItem[]) => documents.filter((document) => document.category === "contract" && !document.subjectTable && (document.mimeType === "application/pdf" || document.mimeType === WORD_MIME) && document.title?.trim());
type Province = { id: string; name: string; code: string };
type Summary = { metrics: { total: number; active: number; pending: number; expiring: number; activeValueByCurrency: { currency: string; value: number }[] } };

const selectClass = "h-10 w-full rounded-xl border border-border-strong bg-surface-1 px-3 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20";
const title = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const date = (value: string | null, fr: boolean) => value ? new Intl.DateTimeFormat(fr ? "fr-FR" : "en-US", { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`)) : "—";
const contractTypeText = (value: string, fr: boolean) => {
  const labels: Record<string, [string, string]> = {
    supply: ["Supply", "Fourniture"],
    sales: ["Sales", "Vente"],
    employment: ["Employment", "Contrat de travail"],
    service: ["Service", "Prestation de service"],
    lease: ["Lease", "Bail / location"],
    loan: ["Loan", "Prêt"],
    insurance: ["Insurance", "Assurance"],
    nda: ["Non-disclosure agreement", "Accord de confidentialité"],
    other: ["Other", "Autre"],
  };
  const label = labels[value];
  return label ? (fr ? label[1] : label[0]) : title(value);
};
const contractStatusText = (value: string, fr: boolean) => {
  const labels: Record<string, [string, string]> = {
    draft: ["Draft", "Brouillon"],
    pending_signature: ["Pending signature", "En attente de signature"],
    ready_for_signature: ["Ready for signature", "Prêt à signer"],
    awaiting_employee_signature: ["Awaiting employee signature", "En attente de signature employé"],
    awaiting_employer_signature: ["Awaiting employer signature", "En attente de contre-signature"],
    signed: ["Signed", "Signé"],
    rejected: ["Rejected", "Refusé"],
    active: ["Active", "Actif"],
    expired: ["Expired", "Expiré"],
    terminated: ["Terminated", "Résilié"],
    renewed: ["Renewed", "Renouvelé"],
    cancelled: ["Cancelled", "Annulé"],
  };
  const label = labels[value];
  return label ? (fr ? label[1] : label[0]) : title(value);
};
const statusTone = (value: ContractStatus) => ["active", "renewed", "signed"].includes(value) ? "good" as const : ["terminated", "cancelled", "rejected"].includes(value) ? "serious" as const : ["pending_signature", "ready_for_signature", "awaiting_employee_signature", "awaiting_employer_signature"].includes(value) ? "warning" as const : "outline" as const;
const blank = (value: FormDataEntryValue | null) => String(value ?? "").trim() || null;
const numberOrNull = (value: FormDataEntryValue | null) => { const parsed = Number(String(value ?? "").trim()); return Number.isFinite(parsed) && String(value ?? "").trim() !== "" ? parsed : null; };
const fieldMessage = (error: Error | null, key: string) => error instanceof ApiError ? error.fieldErrors[key]?.[0] : undefined;
const templateBlocks = (name: string, content: string) => {
  const blocks: { type: "heading" | "paragraph"; text: string }[] = [{ type: "heading", text: name }];
  const paragraph: string[] = [];
  const flush = () => { const text = paragraph.join("\n").trim(); if (text) blocks.push({ type: "paragraph", text }); paragraph.length = 0; };
  for (const rawLine of content.replace(/\r/g, "").split("\n")) {
    const heading = rawLine.match(/^\s*#{1,6}\s+(.+?)\s*$/);
    if (heading) { flush(); blocks.push({ type: "heading", text: heading[1]!.replace(/\*\*(.*?)\*\*/g, "$1") }); continue; }
    paragraph.push(rawLine);
  }
  flush();
  return blocks;
};

export function ContractsArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const fr = locale.startsWith("fr");
  const user = useSessionUser();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Contract | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<"all" | ContractStatus>("all");
  const [workspaceContract, setWorkspaceContract] = useState<Contract | null>(null);
  const [creatingTemplate, setCreatingTemplate] = useState<false | { preset: ReadyContractTemplate | null }>(false);
  const [editingTemplate, setEditingTemplate] = useState<ContractTemplate | null>(null);
  const readable = can(user, "contracts.read");
  const writable = can(user, "contracts.create");
  const canEditTemplates = can(user, "contracts.update");
  const canManageSignerRole = isOwner(user);

  const contracts = useQuery({ queryKey: ["contracts", orgSlug], queryFn: () => get<{ contracts: Contract[] }>(orgUrl(orgSlug, "contracts")), enabled: readable });
  const summary = useQuery({ queryKey: ["contracts-summary", orgSlug], queryFn: () => get<Summary>(orgUrl(orgSlug, "contracts-summary")), enabled: readable });
  const employees = useQuery({ queryKey: ["contract-employees", orgSlug], queryFn: () => get<{ employees: Employee[] }>(orgUrl(orgSlug, "employees")), enabled: writable });
  const documents = useQuery({ queryKey: ["contract-documents", orgSlug], queryFn: () => get<{ documents: DocumentItem[] }>(orgUrl(orgSlug, "documents?category=contract")), enabled: writable });
  const provinces = useQuery({ queryKey: ["contract-provinces", orgSlug], queryFn: () => get<{ provinces: Province[] }>(orgUrl(orgSlug, "provinces")), enabled: writable });
  const signerRoles = useQuery({ queryKey: ["contract-signer-roles", orgSlug], queryFn: () => companySetupApi.listRoles<{ roles: OrganizationRole[] }>(orgSlug), enabled: canManageSignerRole, select: (data) => data.roles });
  const templates = useQuery({ queryKey: ["contract-templates", orgSlug], queryFn: () => get<{ templates: ContractTemplate[] }>(orgUrl(orgSlug, "contracts/templates")), enabled: readable });
  const save = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: unknown }) => id ? patch(orgUrl(orgSlug, `contracts/${id}`), body) : post(orgUrl(orgSlug, "contracts"), body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["contracts", orgSlug] });
      void queryClient.invalidateQueries({ queryKey: ["contracts-summary", orgSlug] });
      setEditing(null);
      setCreating(false);
    },
  });
  const rows = useMemo(() => contracts.data?.contracts.filter((contract) => filter === "all" || contract.status === filter) ?? [], [contracts.data, filter]);

  if (!readable) return <NoAccessState what={fr ? "la consultation des contrats" : "contract access"} />;
  if (contracts.isPending || summary.isPending) return <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8"><SkeletonCard rows={5} /><SkeletonCard rows={6} /></main>;
  if (contracts.isError) return <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8"><ErrorState title={fr ? "Impossible de charger les contrats" : "Could not load contracts"} description={(contracts.error as Error).message} onRetry={() => void contracts.refetch()} /></main>;
  const metrics = summary.data?.metrics;

  return <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
    <header className="relative isolate overflow-hidden rounded-[1.75rem] border border-brand/20 bg-[radial-gradient(circle_at_8%_-30%,rgba(53,182,166,.28),transparent_45%),linear-gradient(125deg,var(--surface-1),var(--surface-2))] p-6 shadow-[0_22px_55px_-36px_rgba(9,62,75,.55)] sm:p-8">
      <div className="absolute right-10 top-0 size-44 rounded-full border border-brand/15" aria-hidden />
      <div className="relative flex flex-wrap items-start justify-between gap-5">
        <div className="max-w-3xl"><div className="flex items-center gap-2 text-brand"><span className="grid size-9 place-items-center rounded-xl border border-brand/20 bg-brand-subtle"><FileSignature className="size-4" /></span><span className="text-sm font-semibold">{fr ? "Juridique & engagements" : "Legal & commitments"}</span></div><h1 className="mt-3 text-2xl font-semibold tracking-[-.035em] text-ink sm:text-3xl">{fr ? "Contrats" : "Contracts"}</h1><p className="mt-2 text-sm leading-6 text-ink-secondary">{fr ? "Centralisez les engagements fournisseurs, employés, services et investissements. Les contrats de travail sont remis à chaque employé dans Mon compte." : "Keep supplier, employment, service and investment commitments in one controlled register. Employment contracts are delivered in each employee’s My account."}</p></div>
        {writable && <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setCreatingTemplate({ preset: null })}><FileSignature />{fr ? "Modèle" : "Template"}</Button><Button onClick={() => setCreating(true)}><Plus />{fr ? "Ajouter un contrat" : "Add contract"}</Button></div>}
      </div>
      <div className="relative mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={FileSignature} label={fr ? "Total" : "Total"} value={String(metrics?.total ?? 0)} tone="sky" /><Metric icon={CheckCircle2} label={fr ? "Actifs" : "Active"} value={String(metrics?.active ?? 0)} tone="emerald" /><Metric icon={BellRing} label={fr ? "À signer" : "Awaiting signature"} value={String(metrics?.pending ?? 0)} tone="amber" /><Metric icon={CalendarClock} label={fr ? "Échéance < 60 j" : "Due < 60 days"} value={String(metrics?.expiring ?? 0)} tone="rose" /></div>
      {canManageSignerRole && metrics?.activeValueByCurrency?.length ? <p className="relative mt-4 text-xs text-ink-secondary">{fr ? "Valeur active : " : "Active value: "}{metrics.activeValueByCurrency.map((item) => new Intl.NumberFormat(fr ? "fr-FR" : "en-US", { style: "currency", currency: item.currency, maximumFractionDigits: 0 }).format(item.value)).join(" · ")}</p> : null}
    </header>

    <TemplateLibrary
      fr={fr}
      templates={templates.data?.templates ?? []}
      loading={templates.isPending}
      error={templates.error instanceof Error ? templates.error.message : null}
      canCreate={writable}
      canEdit={canEditTemplates}
      onCreate={() => setCreatingTemplate({ preset: null })}
      onUseReady={(preset) => setCreatingTemplate({ preset })}
      orgSlug={orgSlug}
      onEdit={setEditingTemplate}
    />

    <section className="overflow-hidden rounded-2xl border border-border-strong/80 bg-surface-1 shadow-[0_18px_44px_-34px_rgba(15,23,42,.52)]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-surface-2 px-5 py-5"><div><h2 className="font-semibold text-ink">{fr ? "Registre des contrats" : "Contract register"}</h2><p className="mt-1 text-xs leading-5 text-ink-secondary">{fr ? "Ouvrez un contrat pour mettre à jour ses conditions, dates, renouvellement, signature ou document." : "Open a contract to update its terms, dates, renewal, signature or document."}</p></div><div className="flex flex-wrap gap-2">{(["all", "active", "pending_signature", "draft", "expired", "terminated"] as const).map((item) => <button key={item} onClick={() => setFilter(item)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${filter === item ? "border-brand bg-brand text-white shadow-sm" : "border-border bg-surface-1 text-ink-secondary hover:border-brand/35 hover:text-brand"}`}>{item === "all" ? (fr ? "Tous" : "All") : contractStatusText(item, fr)}</button>)}</div></div>
      {rows.length ? <div className="divide-y divide-border">{rows.map((contract) => <article key={contract.id} className="group grid gap-4 p-5 transition hover:bg-surface-2/45 lg:grid-cols-[minmax(0,1fr)_auto]"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-semibold text-ink">{contract.title}</h3><Badge variant={statusTone(contract.status)}>{contractStatusText(contract.status, fr)}</Badge>{contract.contractType === "employment" ? <Badge variant="info">{fr ? "Contrat de travail" : "Employment"}</Badge> : null}</div><p className="mt-1.5 text-xs text-ink-secondary">{contract.reference} · {contractTypeText(contract.contractType, fr)} · {contract.counterparty.name ?? "—"}</p><div className="mt-3 grid gap-x-5 gap-y-1.5 text-xs text-ink-secondary sm:grid-cols-2 xl:grid-cols-3"><span><b className="font-medium text-ink">{fr ? "Période" : "Term"}:</b> {date(contract.startsOn, fr)} — {date(contract.endsOn, fr)}</span>{contract.signedOn ? <span><b className="font-medium text-ink">{fr ? "Signé" : "Signed"}:</b> {date(contract.signedOn, fr)}</span> : null}{contract.autoRenews ? <span><b className="font-medium text-ink">{fr ? "Renouvellement" : "Renewal"}:</b> {fr ? "Automatique" : "Automatic"}{contract.renewalNoticeDays !== null ? ` · ${contract.renewalNoticeDays} ${fr ? "jours" : "days"}` : ""}</span> : null}{contract.province?.name ? <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{contract.province.name}</span> : null}{contract.document?.title ? <span className="inline-flex items-center gap-1"><ReceiptText className="size-3" />{contract.document.title}</span> : null}</div>{contract.terminationReason ? <p className="mt-2 text-xs text-critical"><b>{fr ? "Motif de rupture" : "Termination reason"}:</b> {contract.terminationReason}</p> : null}{contract.notes ? <p className="mt-3 max-w-4xl text-sm leading-6 text-ink-secondary">{contract.notes}</p> : null}{contract.contractType === "employment" && ["pending_signature", "active", "renewed"].includes(contract.status) ? <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-brand"><BellRing className="size-3.5" />{fr ? "L’employé lié reçoit une notification et retrouve ce contrat dans Mon compte." : "The linked employee receives a notification and finds this contract in My account."}</p> : null}</div><div className="flex flex-wrap items-center gap-2 lg:self-start">{can(user, "contracts.update") ? <><Button size="sm" variant="secondary" onClick={() => setWorkspaceContract(contract)}><FolderOpen />{fr ? "Espace" : "Workspace"}</Button><Button size="sm" variant="secondary" onClick={() => setEditing(contract)}><Pencil />{fr ? "Modifier" : "Edit"}</Button></> : null}</div></article>)}</div> : <EmptyState icon={CalendarClock} title={fr ? "Aucun contrat dans cette vue" : "No contracts in this view"} description={fr ? "Ajoutez un contrat pour suivre ses obligations, dates, documents et renouvellements." : "Add a contract to follow its obligations, dates, documents and renewals."} action={writable ? { label: fr ? "Ajouter un contrat" : "Add contract", onClick: () => setCreating(true) } : undefined} />}
    </section>

    {workspaceContract && <ContractWorkspaceModal fr={fr} orgSlug={orgSlug} contract={workspaceContract} onClose={() => setWorkspaceContract(null)} />}
    {creatingTemplate && <TemplateForm fr={fr} orgSlug={orgSlug} template={null} preset={creatingTemplate.preset} onClose={() => setCreatingTemplate(false)} />}
    {editingTemplate && <TemplateForm fr={fr} orgSlug={orgSlug} template={editingTemplate} onClose={() => setEditingTemplate(null)} />}
    {(creating || editing) && <ContractForm orgSlug={orgSlug} fr={fr} contract={editing} employees={employees.data?.employees ?? []} documents={documents.data?.documents ?? []} provinces={provinces.data?.provinces ?? []} signerRoles={signerRoles.data ?? []} canManageSignerRole={canManageSignerRole} busy={save.isPending} error={save.error} onClose={() => { setCreating(false); setEditing(null); }} onSave={(body) => save.mutate({ id: editing?.id, body })} />}
  </main>;
}

function TemplateLibrary({ fr, orgSlug, templates, loading, error, canCreate, canEdit, onCreate, onUseReady, onEdit }: { fr: boolean; orgSlug: string; templates: ContractTemplate[]; loading: boolean; error: string | null; canCreate: boolean; canEdit: boolean; onCreate: () => void; onUseReady: (preset: ReadyContractTemplate) => void; onEdit: (template: ContractTemplate) => void }) {
  const queryClient = useQueryClient();
  const existingCodes = new Set(templates.map((template) => template.code));
  const missing = READY_CONTRACT_TEMPLATES.filter((preset) => !existingCodes.has(preset.code));
  const addAll = useMutation({
    mutationFn: async () => {
      for (const preset of missing) await post(orgUrl(orgSlug, "contracts/templates"), { name: preset.name, code: preset.code, contractType: preset.contractType, language: "fr", isActive: true, body: { blocks: templateBlocks(preset.name, preset.text) } });
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["contract-templates", orgSlug] }),
  });
  return <section className="overflow-hidden rounded-2xl border border-border-strong/80 bg-surface-1 shadow-[0_18px_44px_-34px_rgba(15,23,42,.42)]">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-[linear-gradient(112deg,rgba(20,184,166,.08),transparent_48%)] px-5 py-5">
      <div><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg border border-brand/20 bg-brand-subtle text-brand"><FileSignature className="size-4" /></span><h2 className="font-semibold text-ink">{fr ? "Bibliothèque de modèles" : "Template library"}</h2></div><p className="mt-2 max-w-2xl text-xs leading-5 text-ink-secondary">{fr ? "Les modèles réutilisables génèrent de nouvelles versions de contrat. Modifier un modèle ne change jamais les contrats ou signatures déjà envoyés." : "Reusable templates generate new contract versions. Editing a template never changes contracts or signatures already sent."}</p></div>
      {canCreate ? <Button size="sm" onClick={onCreate}><Plus />{fr ? "Créer un modèle" : "Create template"}</Button> : null}
    </div>
    {canCreate ? <div className="border-b border-border bg-surface-2/40 px-5 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold text-ink">{fr ? "Modèles prêts LiteHubs" : "Ready LiteHubs templates"}</p><p className="mt-0.5 text-xs leading-5 text-ink-secondary">{fr ? "Contrats complets prêts à l’emploi : ajoutez-les, puis ajustez seulement si besoin. Faites-les relire par un conseiller en droit du travail avant usage." : "Complete contracts ready to use: add them, then adjust only if needed. Have them reviewed by a labour-law adviser before use."}</p></div>{missing.length ? <Button size="sm" variant="secondary" loading={addAll.isPending} onClick={() => addAll.mutate()}><Plus />{fr ? `Ajouter les ${missing.length} modèles` : `Add ${missing.length} templates`}</Button> : <Badge variant="good">{fr ? "Tous ajoutés" : "All added"}</Badge>}</div>{addAll.error ? <p className="mt-2 text-xs text-critical">{(addAll.error as Error).message}</p> : null}<div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{READY_CONTRACT_TEMPLATES.map((preset) => { const added = existingCodes.has(preset.code); return <div key={preset.key} className="flex flex-col justify-between gap-3 rounded-xl border border-border bg-surface-1 p-3"><div><p className="text-sm font-semibold leading-5 text-ink">{preset.name}</p><p className="mt-1 text-xs leading-5 text-ink-secondary">{preset.summary}</p></div>{added ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-good"><CheckCircle2 className="size-3.5" />{fr ? "Dans vos modèles" : "In your templates"}</span> : <button type="button" onClick={() => onUseReady(preset)} className="self-start text-xs font-semibold text-brand hover:underline">{fr ? "Voir et ajuster →" : "Review and adjust →"}</button>}</div>; })}</div></div> : null}
    {loading ? <div className="p-5"><SkeletonCard rows={2} /></div> : error ? <ErrorState title={fr ? "Impossible de charger les modèles" : "Could not load templates"} description={error} /> : templates.length ? <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">{templates.map((template) => {
      const excerpt = (template.body?.blocks ?? []).map((block) => block.text?.trim()).filter(Boolean).join(" ").slice(0, 180);
      return <article key={template.id} className={`group rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-md ${template.isActive ? "border-brand/20 bg-[linear-gradient(145deg,rgba(20,184,166,.075),transparent_55%),var(--surface-1)]" : "border-border bg-surface-2/45 opacity-80"}`}>
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-semibold text-ink">{template.name}</h3><Badge variant={template.isActive ? "good" : "outline"}>{template.isActive ? (fr ? "Actif" : "Active") : (fr ? "Archivé" : "Archived")}</Badge></div><p className="mt-1 text-xs text-ink-secondary">{template.code} · {contractTypeText(template.contractType, fr)}</p></div>{canEdit ? <Button size="icon-sm" variant="secondary" onClick={() => onEdit(template)} aria-label={fr ? `Modifier ${template.name}` : `Edit ${template.name}`}><Pencil className="size-3.5" /></Button> : null}</div>
        <p className="mt-3 min-h-10 text-xs leading-5 text-ink-secondary">{excerpt || (fr ? "Aperçu du contenu indisponible." : "Content preview unavailable.")}</p>
        <div className="mt-4 flex items-center justify-between border-t border-border/70 pt-3 text-[11px] text-ink-muted"><span>{template.body?.blocks?.length ?? 0} {fr ? "bloc(s)" : "block(s)"}</span><span>{fr ? "Modifié" : "Updated"} {new Intl.DateTimeFormat(fr ? "fr-FR" : "en-US", { dateStyle: "medium" }).format(new Date(template.updatedAt))}</span></div>
      </article>;
    })}</div> : <EmptyState icon={FileSignature} title={fr ? "Aucun modèle enregistré" : "No saved templates"} description={fr ? "Créez un modèle de contrat réutilisable pour générer rapidement des documents cohérents." : "Create a reusable contract template to generate consistent documents quickly."} action={canCreate ? { label: fr ? "Créer un modèle" : "Create template", onClick: onCreate } : undefined} />}
  </section>;
}

function Metric({ icon: Icon, label, value, tone }: { icon: typeof FileSignature; label: string; value: string; tone: "sky" | "emerald" | "amber" | "rose" }) {
  const tones = { sky: "border-sky-500/20 bg-sky-500/8 text-sky-700 dark:text-sky-300", emerald: "border-emerald-500/20 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300", amber: "border-amber-500/20 bg-amber-500/8 text-amber-700 dark:text-amber-300", rose: "border-rose-500/20 bg-rose-500/8 text-rose-700 dark:text-rose-300" };
  return <div className={`rounded-2xl border p-4 ${tones[tone]}`}><Icon className="size-4" /><p className="mt-3 text-xs font-semibold text-ink-muted">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p></div>;
}

function ContractForm({ orgSlug, fr, contract, employees, documents, provinces, signerRoles, canManageSignerRole, busy, error, onClose, onSave }: { orgSlug: string; fr: boolean; contract: Contract | null; employees: Employee[]; documents: DocumentItem[]; provinces: Province[]; signerRoles: OrganizationRole[]; canManageSignerRole: boolean; busy: boolean; error: Error | null; onClose: () => void; onSave: (body: unknown) => void }) {
  const [contractType, setContractType] = useState(contract?.contractType ?? "service");
  const [status, setStatus] = useState<ContractStatus>(contract?.status ?? "draft");
  const employment = contractType === "employment";
  const queryClient = useQueryClient();
  const [documentId, setDocumentId] = useState(contract?.document?.id ?? "");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const contractFiles = importedContracts(documents);
  const uploadContract = async (file: File) => {
    setUploadError(null);
    // Some browsers send no type for .docx: derive it from the extension.
    const extension = file.name.toLowerCase().split(".").pop();
    const type = file.type === "application/pdf" || file.type === WORD_MIME ? file.type : extension === "pdf" ? "application/pdf" : extension === "docx" ? WORD_MIME : "";
    if (!type) { setUploadError(fr ? "Choisissez un fichier PDF ou Word (.docx)." : "Choose a PDF or Word (.docx) file."); return; }
    if (type !== file.type) file = new File([file], file.name, { type });
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("title", file.name.replace(/\.(pdf|docx)$/i, ""));
      body.append("category", "contract");
      body.append("isConfidential", "true");
      const result = await post<{ document?: { id: string }; id?: string }>(orgUrl(orgSlug, "documents"), body, { headers: { "Content-Type": "multipart/form-data" } });
      const id = result.document?.id ?? result.id ?? "";
      await queryClient.invalidateQueries({ queryKey: ["contract-documents", orgSlug] });
      if (id) setDocumentId(id);
    } catch (caught) {
      setUploadError(caught instanceof ApiError ? caught.message : (fr ? "Le fichier n’a pas pu être importé." : "The file could not be uploaded."));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const terminated = status === "terminated";
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const employeeId = employment ? blank(form.get("employeeId")) : null;
    const payload = {
      reference: String(form.get("reference") ?? "").trim() || undefined, title: String(form.get("title") ?? "").trim(), contractType,
      employeeId, counterpartyName: employment ? null : blank(form.get("counterpartyName")),
      startsOn: String(form.get("startsOn") ?? ""), endsOn: blank(form.get("endsOn")), signedOn: employment ? undefined : blank(form.get("signedOn")),
      status: employment ? (contract ? undefined : "draft") : status, terminatedOn: blank(form.get("terminatedOn")), terminationReason: blank(form.get("terminationReason")),
      provinceId: blank(form.get("provinceId")), ...(canManageSignerRole ? { currency: blank(form.get("currency")), contractValue: numberOrNull(form.get("contractValue")), paymentTerms: blank(form.get("paymentTerms")) } : {}),
      ...(canManageSignerRole ? { employerSignerRole: blank(form.get("employerSignerRole")) } : {}), autoRenews: form.get("autoRenews") === "on", renewalNoticeDays: numberOrNull(form.get("renewalNoticeDays")),
      documentId: blank(form.get("documentId")), notes: blank(form.get("notes")),
    };
    onSave(payload);
  };
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-3 backdrop-blur-sm sm:p-6"><form onSubmit={submit} className="mx-auto my-4 max-w-4xl overflow-hidden rounded-[1.5rem] border border-border bg-surface-1 shadow-2xl"><div className="flex items-start justify-between gap-4 border-b border-border bg-surface-2 px-5 py-5 sm:px-7"><div><p className="text-xs font-semibold uppercase tracking-[.15em] text-brand">{fr ? "Registre contrôlé" : "Controlled register"}</p><h2 className="mt-1 text-xl font-semibold text-ink">{contract ? (fr ? "Modifier le contrat" : "Edit contract") : (fr ? "Nouveau contrat" : "New contract")}</h2><p className="mt-1 max-w-2xl text-sm leading-5 text-ink-secondary">{fr ? "Un contrat de travail actif ou à signer est notifié à l’employé concerné lorsqu’un compte LiteHubs est lié." : "An active or pending employment contract notifies the employee when a LiteHubs account is linked."}</p></div><button type="button" onClick={onClose} className="rounded-xl p-2 text-ink-secondary hover:bg-surface-3"><X /></button></div>
    <div className="max-h-[calc(100vh-12rem)] space-y-7 overflow-y-auto px-5 py-6 sm:px-7">{error ? <div className="rounded-xl border border-critical/30 bg-critical/10 p-3 text-sm text-critical"><b>{fr ? "Vérifiez les champs signalés" : "Check the highlighted fields"}</b><p className="mt-1">{error.message}</p></div> : null}
      <FormSection title={fr ? "Identification" : "Identification"}><div className="grid gap-4 sm:grid-cols-2"><Field label={fr ? "Titre du contrat" : "Contract title"} required error={fieldMessage(error, "title")}><Input name="title" required defaultValue={contract?.title ?? ""} /></Field><Field label={fr ? "Référence" : "Reference"} hint={fr ? "Générée automatiquement si vide." : "Generated automatically when blank."} error={fieldMessage(error, "reference")}><Input name="reference" defaultValue={contract?.reference ?? ""} /></Field><Field label={fr ? "Type" : "Type"} required error={fieldMessage(error, "contractType")}><select className={selectClass} value={contractType} onChange={(event) => setContractType(event.target.value)}>{["supply", "sales", "employment", "service", "lease", "loan", "insurance", "nda", "other"].map((item) => <option key={item} value={item}>{contractTypeText(item, fr)}</option>)}</select></Field><Field label={fr ? "Statut" : "Status"} required error={fieldMessage(error, "status")}>{employment ? <div className="rounded-xl border border-brand/25 bg-brand-subtle px-3 py-2.5"><Badge variant={statusTone(contract?.status ?? "draft")}>{contractStatusText(contract?.status ?? "draft", fr)}</Badge><p className="mt-2 text-xs leading-5 text-ink-secondary">{fr ? "Le statut est mis a jour automatiquement par l envoi et les signatures securisees." : "Status is updated automatically by sending and secure signatures."}</p></div> : <select className={selectClass} value={status} onChange={(event) => setStatus(event.target.value as ContractStatus)}>{(["draft", "pending_signature", "active", "expired", "terminated", "renewed", "cancelled"] as ContractStatus[]).map((item) => <option key={item} value={item}>{contractStatusText(item, fr)}</option>)}</select>}</Field></div></FormSection>
      <FormSection title={employment ? (fr ? "Employé et remise" : "Employee and delivery") : (fr ? "Autre partie" : "Counterparty")}><div className="grid gap-4 sm:grid-cols-2">{employment ? <Field label={fr ? "Employé" : "Employee"} required error={fieldMessage(error, "employeeId")} hint={fr ? "L’employé pourra voir ce contrat dans Mon compte quand il est actif ou à signer." : "The employee can view this contract in My account once it is active or pending signature."}><select className={selectClass} name="employeeId" required defaultValue={contract?.counterparty.type === "employee" ? contract.counterparty.id ?? "" : ""}><option value="">{fr ? "Choisir un employé" : "Choose an employee"}</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName} · #{employee.employeeNumber}</option>)}</select></Field> : <Field label={fr ? "Autre partie / entreprise" : "Counterparty / company"} required error={fieldMessage(error, "counterpartyName")}><Input name="counterpartyName" required defaultValue={contract?.counterparty.type === "other" ? contract.counterparty.name ?? "" : ""} /></Field>}<Field label={fr ? "Province" : "Province"} error={fieldMessage(error, "provinceId")}><select className={selectClass} name="provinceId" defaultValue={contract?.province?.id ?? ""}><option value="">{fr ? "Toute l’entreprise" : "Whole organization"}</option>{provinces.map((province) => <option key={province.id} value={province.id}>{province.name} · {province.code}</option>)}</select></Field>{canManageSignerRole ? <Field label={fr ? "Qualité du signataire LiteHubs" : "LiteHubs signer role"} hint={fr ? "Affichée dans le contrat comme qualité du représentant ; elle ne change pas les autorisations LiteHubs." : "Shown in the contract as the authorized representative role; it does not change LiteHubs permissions."} error={fieldMessage(error, "employerSignerRole")}><select className={selectClass} name="employerSignerRole" defaultValue={contract?.employerSignerRole ?? ""}><option value="">{fr ? "Choisir un rôle" : "Choose a role"}</option>{signerRoles.map((role) => <option key={role.id} value={role.name}>{role.name} · {role.code}</option>)}</select></Field> : null}</div></FormSection>
      <FormSection title={fr ? "Durée, signature et renouvellement" : "Term, signature and renewal"}><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Field label={fr ? "Date de début" : "Start date"} required error={fieldMessage(error, "startsOn")}><Input name="startsOn" type="date" required defaultValue={contract?.startsOn ?? new Date().toISOString().slice(0, 10)} /></Field><Field label={fr ? "Date de fin" : "End date"} error={fieldMessage(error, "endsOn")}><Input name="endsOn" type="date" defaultValue={contract?.endsOn ?? ""} /></Field>{employment ? <div className="rounded-xl border border-border bg-surface-2/45 px-3 py-2.5 text-xs leading-5 text-ink-secondary">{fr ? "La date de signature est enregistree automatiquement apres les signatures electroniques." : "The signature date is recorded automatically after electronic signatures."}</div> : <Field label={fr ? "Date de signature" : "Signed date"} error={fieldMessage(error, "signedOn")}><Input name="signedOn" type="date" defaultValue={contract?.signedOn ?? ""} /></Field>}<label className="flex items-center gap-2 rounded-xl border border-border bg-surface-2/45 px-3 text-sm font-medium text-ink"><input name="autoRenews" type="checkbox" defaultChecked={contract?.autoRenews} className="size-4 accent-brand" />{fr ? "Renouvellement automatique" : "Automatic renewal"}</label><Field label={fr ? "Préavis de renouvellement (jours)" : "Renewal notice (days)"} error={fieldMessage(error, "renewalNoticeDays")}><Input name="renewalNoticeDays" type="number" min="0" max="3650" defaultValue={contract?.renewalNoticeDays ?? ""} /></Field>{terminated ? <Field label={fr ? "Date de rupture" : "Termination date"} required error={fieldMessage(error, "terminatedOn")}><Input name="terminatedOn" type="date" required defaultValue={contract?.terminatedOn ?? ""} /></Field> : null}</div>{terminated ? <div className="mt-4"><Field label={fr ? "Motif de rupture" : "Termination reason"} required error={fieldMessage(error, "terminationReason")}><Textarea name="terminationReason" required rows={3} defaultValue={contract?.terminationReason ?? ""} /></Field></div> : null}</FormSection>
      <FormSection title={canManageSignerRole ? (fr ? "Valeur, rémunération et document" : "Value, remuneration and document") : (fr ? "Document" : "Document")}><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{canManageSignerRole ? <><Field label={fr ? "Valeur du contrat" : "Contract value"} hint={fr ? "Confidentiel : propriétaire uniquement." : "Confidential: owner only."} error={fieldMessage(error, "contractValue")}><Input name="contractValue" type="number" min="0" step="0.01" defaultValue={contract?.contractValue ?? ""} /></Field><Field label={fr ? "Devise" : "Currency"} error={fieldMessage(error, "currency")}><select className={selectClass} name="currency" defaultValue={contract?.currency ?? ""}><option value="">—</option><option value="CDF">CDF</option><option value="USD">USD</option><option value="EUR">EUR</option></select></Field></> : null}<Field label={fr ? "Contrat importé (PDF ou Word)" : "Imported contract (PDF or Word)"} hint={fr ? "Facultatif. Le texte est remis au format professionnel LiteHubs à la génération." : "Optional. The text is laid out in the LiteHubs professional format when generated."} error={uploadError ?? fieldMessage(error, "documentId")}><div className="flex gap-2"><select className={`${selectClass} min-w-0 flex-1`} name="documentId" value={documentId} onChange={(event) => setDocumentId(event.target.value)}><option value="">{fr ? "Modèle LiteHubs" : "LiteHubs template"}</option>{contractFiles.map((document) => <option key={document.id} value={document.id}>{document.title}{document.mimeType === WORD_MIME ? " · Word" : " · PDF"}</option>)}{documentId && !contractFiles.some((document) => document.id === documentId) ? <option value={documentId}>{contract?.document?.title ?? (fr ? "Document actuel" : "Current document")}</option> : null}</select><input ref={fileInput} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadContract(file); }} /><Button type="button" variant="secondary" className="shrink-0 px-3" disabled={uploading} onClick={() => fileInput.current?.click()} aria-label={fr ? "Importer un contrat PDF ou Word" : "Upload a PDF or Word contract"} title={fr ? "Importer un contrat PDF ou Word" : "Upload a PDF or Word contract"}><Upload className={uploading ? "size-4 animate-pulse" : "size-4"} /></Button></div></Field></div>{canManageSignerRole ? <div className="mt-4"><Field label={fr ? "Conditions de paiement / rémunération" : "Payment or remuneration terms"} hint={fr ? "Confidentiel : propriétaire uniquement." : "Confidential: owner only."} error={fieldMessage(error, "paymentTerms")}><Textarea name="paymentTerms" rows={3} defaultValue={contract?.paymentTerms ?? ""} placeholder={fr ? "Ex. salaire mensuel, échéancier, délai de paiement, avantages…" : "e.g. monthly salary, schedule, payment terms, benefits…"} /></Field></div> : null}</FormSection>
      <FormSection title={fr ? "Notes internes" : "Internal notes"}><Field label={fr ? "Notes" : "Notes"} error={fieldMessage(error, "notes")}><Textarea name="notes" rows={4} defaultValue={contract?.notes ?? ""} /></Field></FormSection>
    </div><div className="flex flex-wrap justify-end gap-2 border-t border-border bg-surface-2 px-5 py-4 sm:px-7"><Button type="button" variant="secondary" onClick={onClose}>{fr ? "Annuler" : "Cancel"}</Button><Button type="submit" loading={busy}><ShieldCheck />{contract ? (fr ? "Enregistrer les modifications" : "Save changes") : (fr ? "Créer le contrat" : "Create contract")}</Button></div>
  </form></div>;
}
function FormSection({ title, children }: { title: string; children: React.ReactNode }) { return <section><h3 className="mb-3 text-sm font-semibold text-ink">{title}</h3>{children}</section>; }
type ContractWorkspace = { document?: { companyName: string; title: string; reference: string; employerName?: string | null; employerRole?: string | null; employeeName?: string | null; employeeTitle?: string | null; city?: string | null }; currentVersion: null | { id: string; number: number; status: string; signedOn?: string | null; importedFrom?: { documentId: string; fileName: string | null } | null; blocks: { type: "heading" | "paragraph" | "table" | "page_break"; text?: string; rows?: string[][] }[]; fields: { id: string; signerRole: "employee" | "employer"; label: string; status: string; signedName?: string | null; signedAt?: string | null; method?: string | null }[] }; events: { id: string; type: string; createdAt: string; actorName?: string | null }[] };
type ContractTemplate = { id: string; code: string; name: string; contractType: string; language: string; body: { blocks?: { type?: string; text?: string; rows?: string[][] }[] }; isActive: boolean; createdAt: string; updatedAt: string };
/** Full professional employment contract, used when no template is chosen and
 * offered as the starting text of a new template. Have it reviewed before use. */
const DEFAULT_EMPLOYMENT_CONTRACT_TEXT = `Entre les soussignés :
**{{company.name}}**, dont le siège est situé à {{company.address}}, représentée par son représentant dûment habilité en qualité de {{contract.employerSignerRole}}, ci-après dénommée « l’Employeur », d’une part,
Et **{{employee.fullName}}**, matricule {{employee.employeeNumber}}, ci-après dénommé(e) « le Travailleur », d’autre part.
Il a été convenu et arrêté ce qui suit.

## Article 1 — Objet du contrat
L’Employeur engage le Travailleur, qui accepte, en qualité de **{{employee.jobTitle}}**. Le Travailleur exerce ses fonctions sous l’autorité de l’Employeur ou de tout responsable désigné par lui.

## Article 2 — Date d’effet et durée
Le présent contrat prend effet le **{{contract.startDate}}**. Lorsqu’une date de fin est indiquée, il prend fin le **{{contract.endDate}}** ; à défaut, il est conclu pour une durée indéterminée.
Toute prolongation ou modification fait l’objet d’un avenant écrit signé par les deux parties.

## Article 3 — Période d’essai
Le contrat comporte une période d’essai dont la durée et les conditions sont celles prévues par la législation du travail applicable. Pendant cette période, chaque partie peut mettre fin au contrat dans les conditions prévues par la loi.

## Article 4 — Lieu de travail
Le Travailleur exerce principalement ses fonctions à **{{employee.workLocation}}**. Selon les besoins de l’activité, il peut être affecté à un autre site de l’Employeur, après information préalable.

## Article 5 — Fonctions et obligations du Travailleur
Le Travailleur s’engage à :
1. exécuter avec soin, honnêteté et professionnalisme les tâches liées à son poste ;
2. respecter les consignes de ses responsables et le règlement intérieur ;
3. préserver les biens, outils, stocks, animaux, cultures, équipements et informations de l’Employeur ;
4. respecter les horaires et les procédures de présence (pointage LiteHubs) ;
5. signaler sans délai tout incident, accident, perte, maladie animale ou risque pour la sécurité.

## Article 6 — Durée du travail et horaires
La durée du travail et les horaires sont ceux affectés au Travailleur dans LiteHubs, dans le respect de la durée légale du travail. Toute absence ou tout retard doit être signalé et justifié selon les procédures internes.

## Article 7 — Rémunération
En contrepartie de son travail, le Travailleur perçoit une rémunération de base de **{{contract.salary}} {{contract.currency}}**, payable selon la périodicité en vigueur dans l’entreprise. Les primes, indemnités et retenues éventuelles suivent les règles internes et la réglementation applicable. Chaque paiement est accompagné d’un bulletin de paie.

## Article 8 — Congés
Le Travailleur bénéficie des congés payés et des jours fériés prévus par la législation du travail applicable. Les dates de congé sont fixées en accord avec l’Employeur selon les besoins du service.

## Article 9 — Santé, sécurité et biosécurité
Le Travailleur respecte toutes les règles de santé, de sécurité, d’hygiène et de biosécurité applicables à son site, et porte les équipements de protection fournis. Il est interdit de contourner une procédure de sécurité ou de mettre en danger des personnes, des animaux ou des installations.

## Article 10 — Confidentialité
Le Travailleur s’engage à ne pas divulguer, pendant et après le contrat, les informations confidentielles de l’Employeur : données financières, clients, fournisseurs, procédures internes, documents et accès LiteHubs. Tout matériel confié doit être restitué à la fin du contrat ou sur demande.

## Article 11 — Discipline
Tout manquement aux obligations du présent contrat ou au règlement intérieur peut donner lieu à une procédure disciplinaire conforme à la législation applicable et aux procédures internes de l’Employeur.

## Article 12 — Suspension et fin du contrat
Le contrat peut être suspendu ou prendre fin dans les cas et selon les formes prévus par la législation du travail applicable, notamment à l’échéance du terme, d’un commun accord, par démission ou par licenciement, dans le respect du préavis légal.

## Article 13 — Règlement des différends
Les parties s’efforcent de régler à l’amiable tout différend lié au présent contrat. À défaut, le différend est soumis à l’inspection du travail puis, le cas échéant, aux juridictions compétentes.

## Article 14 — Dispositions finales
Le présent contrat est régi par la législation du travail en vigueur. Les parties déclarent avoir lu, compris et accepté l’ensemble de ses clauses. Il est établi en deux exemplaires originaux, un pour chaque partie.`;
const defaultContractBlocks = { blocks: templateBlocks("CONTRAT DE TRAVAIL", DEFAULT_EMPLOYMENT_CONTRACT_TEXT) };
const EVENT_LABELS: Record<string, [string, string]> = {
  version_generated: ["Version generated", "Version générée"],
  sent_for_employee_signature: ["Sent to the employee for signature", "Envoyé à l’employé pour signature"],
  signature_reminder_sent: ["Signature reminder sent", "Rappel de signature envoyé"],
  employee_signature_added: ["Employee signed", "Signature de l’employé"],
  employer_signature_added: ["Employer countersigned", "Contre-signature de l’employeur"],
  contract_finalized: ["Final signed copy sealed", "Exemplaire final signé et scellé"],
  printed_for_paper_signature: ["Printed for a handwritten signature", "Imprimé pour signature à la main"],
  paper_signature_recorded: ["Signed paper copy recorded", "Exemplaire papier signé enregistré"],
};
const eventLabel = (type: string, fr: boolean) => { const label = EVENT_LABELS[type]; return label ? (fr ? label[1] : label[0]) : type.replaceAll("_", " "); };
function createSignatureFields(fr: boolean, employeeCount: number, employerCount: number) {
  const employee = Array.from({ length: Math.max(1, Math.min(6, employeeCount)) }, (_, index) => ({ signerRole: "employee", label: `${fr ? "Signature employé" : "Employee signature"} ${index + 1}`, pageNumber: 1, x: 55, y: 88 + index * 58, width: 200, height: 42, fieldOrder: index + 1, isRequired: true }));
  const employer = Array.from({ length: Math.max(1, Math.min(6, employerCount)) }, (_, index) => ({ signerRole: "employer", label: `${fr ? "Contre-signature employeur" : "Employer countersignature"} ${index + 1}`, pageNumber: 1, x: 330, y: 88 + index * 58, width: 200, height: 42, fieldOrder: index + 1, isRequired: true }));
  return [...employee, ...employer];
}
function EmployerSignatureCapture({ mode, value, onChange, fr }: { mode: "drawn" | "uploaded"; value: string | null; onChange: (value: string | null) => void; fr: boolean }) {
  const canvas = useRef<HTMLCanvasElement | null>(null); const drawing = useRef(false);
  const point = (event: PointerEvent<HTMLCanvasElement>) => { const node = canvas.current!; const box = node.getBoundingClientRect(); return { x: (event.clientX - box.left) * (node.width / box.width), y: (event.clientY - box.top) * (node.height / box.height) }; };
  const begin = (event: PointerEvent<HTMLCanvasElement>) => { if (mode !== "drawn") return; drawing.current = true; event.currentTarget.setPointerCapture(event.pointerId); const context = canvas.current?.getContext("2d"); const position = point(event); if (context) { context.beginPath(); context.moveTo(position.x, position.y); } };
  const move = (event: PointerEvent<HTMLCanvasElement>) => { if (!drawing.current || mode !== "drawn") return; const context = canvas.current?.getContext("2d"); const position = point(event); if (context) { context.lineWidth = 2.4; context.lineCap = "round"; context.strokeStyle = "#0f766e"; context.lineTo(position.x, position.y); context.stroke(); } };
  const finish = () => { if (!drawing.current) return; drawing.current = false; onChange(canvas.current?.toDataURL("image/png") ?? null); };
  if (mode === "uploaded") return <label className="block rounded-xl border border-dashed border-border bg-surface-1 p-3 text-xs text-ink-secondary">{fr ? "Image de signature (PNG ou JPEG)" : "Signature image (PNG or JPEG)"}<input type="file" accept="image/png,image/jpeg" className="mt-2 block w-full text-xs" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => onChange(typeof reader.result === "string" ? reader.result : null); reader.readAsDataURL(file); }} />{value ? <span className="mt-2 block text-good">{fr ? "Image prête" : "Image ready"}</span> : null}</label>;
  return <div className="rounded-xl border border-dashed border-border bg-surface-1 p-3"><div className="flex items-center justify-between gap-2"><p className="text-xs text-ink-secondary">{fr ? "Dessinez votre signature dans le cadre" : "Draw your signature inside the frame"}</p><button type="button" onClick={() => { const context = canvas.current?.getContext("2d"); context?.clearRect(0, 0, 520, 130); onChange(null); }} className="text-xs font-semibold text-brand">{fr ? "Effacer" : "Clear"}</button></div><canvas ref={canvas} width={520} height={130} onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} className="mt-2 h-28 w-full touch-none rounded-lg bg-white" aria-label={fr ? "Dessinez votre signature" : "Draw your signature"} /></div>;
}
function EmployerSigningDialog({ fr, busy, error, legalName, onLegalName, signatureMethod, onSignatureMethod, signatureData, onSignatureData, acknowledged, onAcknowledged, onClose, onSign }: { fr: boolean; busy: boolean; error: Error | null; legalName: string; onLegalName: (value: string) => void; signatureMethod: "typed" | "drawn" | "uploaded"; onSignatureMethod: (value: "typed" | "drawn" | "uploaded") => void; signatureData: string | null; onSignatureData: (value: string | null) => void; acknowledged: boolean; onAcknowledged: (value: boolean) => void; onClose: () => void; onSign: () => void }) {
  return <div className="fixed inset-0 z-[70] grid place-items-end bg-slate-950/60 p-0 backdrop-blur-sm sm:place-items-center sm:p-6"><section role="dialog" aria-modal="true" aria-labelledby="employer-signature-title" className="w-full max-w-lg overflow-hidden rounded-t-[1.6rem] border border-border bg-surface-1 shadow-2xl sm:rounded-[1.6rem]"><header className="flex items-start justify-between gap-4 border-b border-border bg-[linear-gradient(120deg,rgba(20,184,166,.14),transparent_60%)] px-5 py-5"><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-brand">{fr ? "Contre-signature sécurisée" : "Secure countersignature"}</p><h3 id="employer-signature-title" className="mt-1 text-lg font-semibold text-ink">{fr ? "Signer au nom de l’employeur" : "Sign for the employer"}</h3><p className="mt-1 text-xs leading-5 text-ink-secondary">{fr ? "Le nom légal et la signature seront intégrés au document final et à son historique de preuve." : "The legal name and signature will be included in the final document and its evidence history."}</p></div><button type="button" onClick={onClose} className="rounded-xl p-2 text-ink-secondary hover:bg-surface-3" aria-label={fr ? "Fermer" : "Close"}>×</button></header><div className="max-h-[72vh] space-y-4 overflow-y-auto px-5 py-5"><label className="block text-xs font-semibold text-ink">{fr ? "Nom du signataire autorisé" : "Authorized signer name"}<input value={legalName} onChange={(event) => onLegalName(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-border bg-surface-1 px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" placeholder={fr ? "Votre nom légal complet" : "Your complete legal name"} /></label><div><p className="text-xs font-semibold text-ink">{fr ? "Méthode de signature" : "Signature method"}</p><div className="mt-2 grid grid-cols-3 gap-2"><button type="button" onClick={() => { onSignatureMethod("drawn"); onSignatureData(null); }} className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border px-2 text-center text-[11px] font-semibold ${signatureMethod === "drawn" ? "border-brand bg-brand-subtle text-brand shadow-sm" : "border-border bg-surface-1 text-ink-secondary"}`}><PenLine className="size-4" />{fr ? "Signer au stylo" : "Sign with pen"}</button><button type="button" onClick={() => { onSignatureMethod("typed"); onSignatureData(null); }} className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border px-2 text-center text-[11px] font-semibold ${signatureMethod === "typed" ? "border-brand bg-brand-subtle text-brand shadow-sm" : "border-border bg-surface-1 text-ink-secondary"}`}><Type className="size-4" />{fr ? "Saisir le nom" : "Type name"}</button><button type="button" onClick={() => { onSignatureMethod("uploaded"); onSignatureData(null); }} className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border px-2 text-center text-[11px] font-semibold ${signatureMethod === "uploaded" ? "border-brand bg-brand-subtle text-brand shadow-sm" : "border-border bg-surface-1 text-ink-secondary"}`}><Upload className="size-4" />{fr ? "Importer" : "Upload"}</button></div></div>{signatureMethod === "typed" ? <div className="rounded-xl border border-dashed border-border bg-surface-2/45 px-3 py-3"><p className="text-[11px] font-medium text-ink-muted">{fr ? "Aperçu de la signature saisie" : "Typed signature preview"}</p><p className="mt-1 font-serif text-xl italic text-ink">{legalName || (fr ? "Votre nom légal" : "Your legal name")}</p></div> : <EmployerSignatureCapture mode={signatureMethod} value={signatureData} onChange={onSignatureData} fr={fr} />}<label className="flex gap-2 text-xs leading-5 text-ink"><input type="checkbox" checked={acknowledged} onChange={(event) => onAcknowledged(event.target.checked)} className="mt-0.5 size-4 accent-brand" />{fr ? "Je confirme avoir lu et compris ce contrat. Je consens à le signer électroniquement au nom de l’employeur autorisé." : "I confirm that I have read and understood this contract. I consent to sign it electronically as the authorized employer."}</label>{error ? <p className="rounded-xl border border-critical/30 bg-critical/10 p-3 text-xs text-critical">{error.message}</p> : null}</div><footer className="flex flex-col-reverse gap-2 border-t border-border bg-surface-2 px-5 py-4 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className="rounded-xl border border-border bg-surface-1 px-4 py-2.5 text-sm font-semibold text-ink">{fr ? "Annuler" : "Cancel"}</button><button type="button" disabled={!acknowledged || !legalName.trim() || busy || (signatureMethod !== "typed" && !signatureData)} onClick={onSign} className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><ShieldCheck className="size-4" />{busy ? (fr ? "Contre-signature…" : "Countersigning…") : (fr ? "Signer au nom de l’employeur" : "Sign for the employer")}</button></footer></section></div>;
}function ContractWorkspaceModal({ fr, orgSlug, contract, onClose }: { fr: boolean; orgSlug: string; contract: Contract; onClose: () => void }) {
  const user = useSessionUser(); const canCountersign = isOwner(user) || hasRole(user, "general_manager");
  const queryClient = useQueryClient(); const [templateId, setTemplateId] = useState(""); const [regenerating, setRegenerating] = useState(false); const [employeeFields, setEmployeeFields] = useState(1); const [employerFields, setEmployerFields] = useState(1); const [legalName, setLegalName] = useState(""); const [acknowledged, setAcknowledged] = useState(false); const [signatureMethod, setSignatureMethod] = useState<"typed" | "drawn" | "uploaded">("drawn"); const [signatureData, setSignatureData] = useState<string | null>(null); const [counterSignatureDialog, setCounterSignatureDialog] = useState(false); const employerSignaturePanel = useRef<HTMLDivElement | null>(null);
  const workspace = useQuery({ queryKey:["contract-workspace",orgSlug,contract.id], queryFn:()=>get<ContractWorkspace>(orgUrl(orgSlug,`contracts/${contract.id}/workspace`)) });
  const templates = useQuery({ queryKey:["contract-templates",orgSlug], queryFn:()=>get<{templates:ContractTemplate[]}>(orgUrl(orgSlug,"contracts/templates")) });
  const refresh=()=>{ void queryClient.invalidateQueries({queryKey:["contract-workspace",orgSlug,contract.id]}); void queryClient.invalidateQueries({queryKey:["contracts",orgSlug]}); void queryClient.invalidateQueries({queryKey:["contracts-summary",orgSlug]}); };
  const generate=useMutation({ mutationFn:()=>post(orgUrl(orgSlug,`contracts/${contract.id}/workspace/versions`),{ templateId: templateId || null, sourceDocumentId: !templateId && contract.document?.id ? contract.document.id : null, body: templateId || contract.document?.id ? null : defaultContractBlocks, signatureFields:createSignatureFields(fr,employeeFields,employerFields) }), onSuccess:()=>{ setRegenerating(false); refresh(); } });
  const send=useMutation({ mutationFn:(versionId:string)=>post(orgUrl(orgSlug,`contracts/${contract.id}/workspace/send`),{versionId}),onSuccess:refresh });
  const remind=useMutation({ mutationFn:()=>post(orgUrl(orgSlug,`contracts/${contract.id}/workspace/remind-signature`),{}),onSuccess:refresh });
  const countersign=useMutation({ mutationFn:(fieldId:string)=>patch(orgUrl(orgSlug,`contracts/${contract.id}/workspace/signatures/${fieldId}`),{legalName:legalName.trim(),method:signatureMethod,signatureData,acknowledged}),onSuccess:refresh });
  const current=workspace.data?.currentVersion;
  // `bg-ink/45` and `rounded-3xl`, matching the six other workspace modals.
  // This one was the outlier on `bg-slate-950/60` and a one-off `1.6rem`
  // radius, and the difference is visible when two dialogs open in sequence.
  // The header wash now derives from `--brand` too: it was hardcoded teal
  // while every accent inside this same modal — the eyebrow, the signature
  // method borders, the countersign icon — is brand blue.
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-ink/45 p-4 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-labelledby="contract-workspace-title" className="mx-auto my-3 max-w-6xl overflow-hidden rounded-3xl border border-border bg-surface-1 shadow-xl"><header className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-linear-to-br from-brand/10 to-transparent px-5 py-5 sm:px-7"><div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-[.14em] text-brand">{fr?"Espace de contrat sécurisé":"Secure contract workspace"}</p><h2 id="contract-workspace-title" className="mt-1.5 truncate text-xl font-semibold tracking-[-0.01em] text-ink">{contract.title}</h2><p className="mt-1.5 text-xs leading-5 text-ink-secondary"><span className="font-medium text-ink-secondary">{contract.reference}</span> · {fr?"Versions immuables, signatures par emplacement et historique vérifiable.":"Immutable versions, per-field signatures and a verifiable history."}</p></div><button type="button" onClick={onClose} className="shrink-0 rounded-xl p-2 text-ink-secondary outline-none transition-colors hover:bg-surface-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-label={fr?"Fermer":"Close"}><X /></button></header><div className="grid min-h-[60vh] lg:grid-cols-[minmax(0,1fr)_19rem]"><div className="space-y-5 p-5 sm:p-7">{workspace.isPending?<p className="text-sm text-ink-secondary">{fr?"Chargement de l’espace…":"Loading workspace…"}</p>:workspace.isError?<p className="rounded-xl border border-critical/30 bg-critical/10 p-3 text-sm text-critical">{(workspace.error as Error).message}</p>:<><div className="rounded-2xl border border-border bg-surface-2 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0">{/* The status was a "Statut : Brouillon" sentence. It is a state, and
                every other status in this file is a Badge -- reading it as prose
                meant scanning a paragraph for the one word that matters. */}
                <div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-ink">{current?`${fr?"Version":"Version"} ${current.number}`:(fr?"Aucune version de document":"No document version")}</p>{current?<Badge variant={statusTone(current.status as ContractStatus)}>{contractStatusText(current.status,fr)}</Badge>:null}</div>{!current?<p className="mt-1 text-xs leading-5 text-ink-secondary">{fr?"Générez d’abord une version PDF contrôlée depuis un modèle.":"First generate a controlled PDF version from a template."}</p>:null}</div>{current?<div className="flex shrink-0 gap-2">{/* These two had no hover or focus state at all, which on a
                  download control reads as a disabled label rather than a
                  button. */}
                  <a href={orgApiUrl(orgSlug,`contracts/${contract.id}/workspace/preview`)} target="_blank" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 py-2 text-xs font-semibold text-ink outline-none transition-colors hover:border-border-strong hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><FileSignature className="size-3.5" />{fr?"Aperçu":"Preview"}</a><a href={orgApiUrl(orgSlug,`contracts/${contract.id}/workspace/document`)} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 py-2 text-xs font-semibold text-ink outline-none transition-colors hover:border-border-strong hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><Download className="size-3.5" />PDF</a>{current && !["signed","active"].includes(current.status) && current.fields.every((field)=>field.status!=="signed") ? <button type="button" onClick={()=>setRegenerating((value)=>!value)} className="inline-flex items-center gap-1.5 rounded-lg border border-brand/40 bg-surface-1 px-3 py-2 text-xs font-semibold text-brand outline-none transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><Plus className="size-3.5" />{regenerating?(fr?"Annuler":"Cancel"):(fr?"Nouvelle version":"New version")}</button> : null}</div>:null}</div>{!current||regenerating?<div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]"><p className="sm:col-span-2 text-xs text-ink-secondary">{contract.document?.id ? (fr?"Le contrat importé sera remis au format professionnel LiteHubs : même en-tête, articles, bloc de signature et sécurité. Un PDF scanné (sans texte) garde ses pages et reçoit une page de signatures. Choisissez un modèle pour l’utiliser à la place.":"The imported contract is laid out in the LiteHubs professional format: same header, clauses, signature block and security. A scanned PDF (no text) keeps its pages and gets a signature page. Choose a template to use it instead.") : (fr?"Choisissez un modèle ou générez le document professionnel LiteHubs par défaut.":"Choose a template or generate the default LiteHubs professional document.")}{current?(fr?" La nouvelle version remplace la version actuelle (non signée) ; l’envoi précédent est annulé.":" The new version replaces the current unsigned one; any previous sending is cancelled."):""}</p><select value={templateId} onChange={(event)=>setTemplateId(event.target.value)} className={selectClass}><option value="">{fr?"Modèle professionnel LiteHubs par défaut":"Default LiteHubs professional template"}</option>{(templates.data?.templates??[]).filter((item)=>item.contractType===contract.contractType).map((item)=><option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</select><div className="flex items-center gap-2 rounded-xl border border-border bg-surface-1 px-2 py-1"><label className="text-[10px] font-semibold text-ink-secondary">{fr?"Emp.":"Emp."}<input aria-label={fr?"Signatures employé":"Employee signatures"} type="number" min="1" max="6" value={employeeFields} onChange={(event)=>setEmployeeFields(Number(event.target.value)||1)} className="ml-1 h-7 w-9 bg-transparent text-center text-xs text-ink" /></label><label className="text-[10px] font-semibold text-ink-secondary">{fr?"Employeur":"Employer"}<input aria-label={fr?"Contre-signatures":"Employer signatures"} type="number" min="1" max="6" value={employerFields} onChange={(event)=>setEmployerFields(Number(event.target.value)||1)} className="ml-1 h-7 w-9 bg-transparent text-center text-xs text-ink" /></label></div><Button onClick={()=>generate.mutate()} disabled={generate.isPending}><FileSignature />{generate.isPending?(fr?"Génération…":"Generating…"):(fr?"Générer le PDF":"Generate PDF")}</Button></div>:null}{generate.error?<p className="mt-3 text-xs text-critical">{(generate.error as Error).message}</p>:null}</div>{current?.blocks?.length ? <div className="overflow-hidden rounded-2xl border border-border"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-3"><p className="text-xs font-semibold uppercase tracking-[.12em] text-ink-muted">{fr ? "Document" : "Document"}</p><p className="text-xs text-ink-secondary">{fr ? "Mise en page identique au PDF." : "Same layout as the PDF."}</p></div>{current.importedFrom ? <p className="border-b border-border bg-warning/10 px-4 py-2 text-xs leading-5 text-ink">{fr ? `Texte importé de « ${current.importedFrom.fileName ?? "contrat"} » et remis au format LiteHubs. Relisez-le avant l’envoi ; si un passage est mal lu, collez le texte dans un modèle et générez une nouvelle version.` : `Text imported from “${current.importedFrom.fileName ?? "contract"}” and laid out in the LiteHubs format. Review it before sending; if a passage was misread, paste the text into a template and generate a new version.`}</p> : null}<div className="max-h-[44rem] overflow-y-auto"><ContractPaper fr={fr} title={contract.title} reference={contract.reference} versionLabel={`V${current.number}`} blocks={current.blocks} parties={{ companyName: workspace.data?.document?.companyName ?? "", employerName: workspace.data?.document?.employerName, employerRole: workspace.data?.document?.employerRole, employeeName: workspace.data?.document?.employeeName, employeeTitle: workspace.data?.document?.employeeTitle, city: workspace.data?.document?.city }} employer={current.fields.find((field) => field.signerRole === "employer")} employee={current.fields.find((field) => field.signerRole === "employee")} signedOn={current.signedOn} employerAction={current.status === "awaiting_employer_signature" && canCountersign ? <button type="button" onClick={() => { setSignatureMethod("drawn"); setSignatureData(null); setCounterSignatureDialog(true); }} className="inline-flex items-center gap-2 rounded-lg border border-dashed border-emerald-700/50 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"><PenLine className="size-4" />{fr ? "Cliquer pour signer" : "Click to sign"}</button> : null} /></div></div> : null}{current && current.status !== "signed" && (contract.contractType !== "employment" || canCountersign) ? <PaperSignaturePanel fr={fr} orgSlug={orgSlug} contractId={contract.id} onDone={refresh} /> : null}{current?<section className="rounded-2xl border border-border bg-surface-1"><div className="border-b border-border px-4 py-3"><h3 className="text-sm font-semibold text-ink">{fr?"Emplacements de signature":"Signature fields"}</h3><p className="mt-1 text-xs text-ink-secondary">{fr?"Chaque emplacement est signé séparément. Rien ne devient actif avant les signatures requises.":"Each field is signed separately. Nothing becomes active until all required signatures are present."}</p></div><div className="divide-y divide-border">{current.fields.map((field)=><div key={field.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div><p className="text-sm font-medium text-ink">{field.label}</p><p className="mt-0.5 text-xs text-ink-secondary">{field.signerRole==="employee"?(fr?"Employé":"Employee"):(fr?"Employeur":"Employer")} · {field.signedAt?(fr?`Signé par ${field.signedName}`:`Signed by ${field.signedName}`):(fr?"En attente":"Pending")}</p></div><Badge variant={field.status==="signed"?"good":"warning"}>{field.status==="signed"?(fr?"Signé":"Signed"):(fr?"En attente":"Pending")}</Badge></div>)}</div>{current.status==="draft"?<div className="border-t border-border bg-surface-2 px-4 py-3"><Button onClick={()=>send.mutate(current.id)} disabled={send.isPending}><Send />{send.isPending?(fr?"Envoi…":"Sending…"):(fr?"Envoyer à l’employé pour signature":"Send to employee for signature")}</Button>{send.error?<p className="mt-2 text-xs text-critical">{(send.error as Error).message}</p>:null}</div>:null}{current.status==="awaiting_employee_signature"?<div className="border-t border-border bg-warning/5 px-4 py-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold text-ink">{fr?"Signature employé en attente":"Employee signature pending"}</p><p className="mt-1 text-xs text-ink-secondary">{fr?"Renvoyez une notification sécurisée si l’employé a activé son compte après l’envoi initial.":"Resend a secure notification if the employee activated their account after the original send."}</p></div><Button size="sm" variant="secondary" onClick={()=>remind.mutate()} disabled={remind.isPending}><BellRing />{remind.isPending?(fr?"Envoi…":"Sending…"):(fr?"Renvoyer la notification":"Resend notification")}</Button></div>{remind.error?<p className="mt-2 text-xs text-critical">{(remind.error as Error).message}</p>:null}</div>:null}{current.status==="awaiting_employer_signature"?<div ref={employerSignaturePanel} className="border-t border-border bg-brand-subtle px-4 py-5"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-white"><PenLine className="size-5" /></span><div><p className="text-sm font-semibold text-ink">{fr?"Contre-signature employeur requise":"Employer countersignature required"}</p><p className="mt-1 text-xs leading-5 text-ink-secondary">{fr?"Seul le propriétaire ou un General Manager peut contre-signer. Le nom, la méthode, l’horodatage et l’empreinte finale sont conservés dans la preuve du contrat.":"Only the owner or a General Manager may countersign. The name, method, timestamp, and final hash are kept in the contract evidence."}</p></div></div><div className="mt-4 space-y-4"><label className="block text-xs font-semibold text-ink">{fr?"Nom légal du signataire autorisé":"Authorized signer’s legal name"}<input value={legalName} onChange={(event)=>setLegalName(event.target.value)} placeholder={fr?"Votre nom légal complet":"Your full legal name"} className={`mt-1.5 ${selectClass}`}/></label><div><p className="text-xs font-semibold text-ink">{fr?"Méthode de signature":"Signature method"}</p><div className="mt-2 grid grid-cols-3 gap-2"><button type="button" onClick={()=>{setSignatureMethod("drawn");setSignatureData(null);}} className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border px-2 text-center text-[11px] font-semibold ${signatureMethod==="drawn"?"border-brand bg-surface-1 text-brand shadow-sm":"border-border bg-surface-1 text-ink-secondary"}`}><PenLine className="size-4" />{fr?"Signer au stylo":"Sign with pen"}</button><button type="button" onClick={()=>{setSignatureMethod("typed");setSignatureData(null);}} className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border px-2 text-center text-[11px] font-semibold ${signatureMethod==="typed"?"border-brand bg-surface-1 text-brand shadow-sm":"border-border bg-surface-1 text-ink-secondary"}`}><Type className="size-4" />{fr?"Saisir le nom":"Type name"}</button><button type="button" onClick={()=>{setSignatureMethod("uploaded");setSignatureData(null);}} className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border px-2 text-center text-[11px] font-semibold ${signatureMethod==="uploaded"?"border-brand bg-surface-1 text-brand shadow-sm":"border-border bg-surface-1 text-ink-secondary"}`}><Upload className="size-4" />{fr?"Importer":"Upload"}</button></div></div>{signatureMethod==="typed"?<div className="rounded-xl border border-dashed border-border bg-surface-1 px-3 py-3"><p className="text-[11px] font-medium text-ink-muted">{fr?"Aperçu de la signature saisie":"Typed signature preview"}</p><p className="mt-1 font-serif text-xl italic text-ink">{legalName || (fr?"Votre nom légal":"Your legal name")}</p></div>:<EmployerSignatureCapture mode={signatureMethod} value={signatureData} onChange={setSignatureData} fr={fr}/>}<label className="flex gap-2 text-xs leading-5 text-ink-secondary"><input type="checkbox" checked={acknowledged} onChange={(event)=>setAcknowledged(event.target.checked)} className="mt-0.5 size-4 accent-brand" />{fr?"Je confirme avoir lu et compris ce contrat. Je consens à le signer électroniquement au nom de l’employeur autorisé.":"I confirm that I have read and understood this contract. I consent to sign it electronically as the authorized employer."}</label><Button disabled={!canCountersign||!acknowledged||!legalName.trim()||countersign.isPending||(signatureMethod!=="typed"&&!signatureData)} onClick={()=>{const field=current.fields.find((item)=>item.signerRole==="employer"&&item.status!=="signed"); if(field)countersign.mutate(field.id);}}><ShieldCheck />{countersign.isPending?(fr?"Contre-signature…":"Countersigning…"):(fr?"Signer au nom de l’employeur":"Sign for the employer")}</Button>{countersign.error?<p className="text-xs text-critical">{(countersign.error as Error).message}</p>:null}</div></div>:null}</section>:null}</>} </div><aside className="border-t border-border bg-surface-2 p-5 lg:border-l lg:border-t-0"><p className="text-[11px] font-semibold uppercase tracking-[.12em] text-ink-muted">{fr?"Historique de preuve":"Evidence timeline"}</p>{/* A continuous rail with a dot per event, rather than a detached
            left border on each row. This is an audit trail, and a single
            unbroken line is what makes it read as an ordered sequence with no
            gaps -- which is the claim the panel is making. `capitalize` covers
            the raw event codes ("version generated"). */}
          <div className="mt-4">{(workspace.data?.events??[]).length?<ol className="relative space-y-4 border-l border-border pl-4">{(workspace.data?.events??[]).map((event)=><li key={event.id} className="relative"><span className="absolute -left-5.25 top-1 size-2 rounded-full bg-brand ring-2 ring-surface-2" aria-hidden /><p className="text-xs font-semibold text-ink">{eventLabel(event.type, fr)}</p><p className="mt-0.5 text-[11px] leading-4 text-ink-secondary">{event.actorName??"—"} · {new Intl.DateTimeFormat(fr?"fr-FR":"en-US",{dateStyle:"medium",timeStyle:"short"}).format(new Date(event.createdAt))}</p></li>)}</ol>:<p className="text-xs leading-5 text-ink-secondary">{fr?"Les générations, envois, lectures et signatures apparaîtront ici.":"Generation, sending, viewing and signing events will appear here."}</p>}</div></aside></div></section>{counterSignatureDialog && current ? <EmployerSigningDialog fr={fr} busy={countersign.isPending} error={countersign.error instanceof Error ? countersign.error : null} legalName={legalName} onLegalName={setLegalName} signatureMethod={signatureMethod} onSignatureMethod={setSignatureMethod} signatureData={signatureData} onSignatureData={setSignatureData} acknowledged={acknowledged} onAcknowledged={setAcknowledged} onClose={() => setCounterSignatureDialog(false)} onSign={() => { const field = current.fields.find((item) => item.signerRole === "employer" && item.status !== "signed"); if (field) countersign.mutate(field.id); setCounterSignatureDialog(false); }} /> : null}</div>;
}
/** Handwritten signature: print the copy, sign it on paper, then record the scan. */
function PaperSignaturePanel({ fr, orgSlug, contractId, onDone }: { fr: boolean; orgSlug: string; contractId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const record = useMutation({
    mutationFn: (form: FormData) => post(orgUrl(orgSlug, `contracts/${contractId}/workspace/paper-signature`), form, { headers: { "Content-Type": "multipart/form-data" } }),
    onSuccess: () => { setOpen(false); onDone(); },
  });
  const today = new Date().toLocaleDateString("en-CA");
  return <section className="rounded-2xl border border-border bg-surface-1">
    <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4">
      <div className="min-w-0 max-w-xl"><h3 className="text-sm font-semibold text-ink">{fr ? "Signature à la main (papier)" : "Handwritten signature (paper)"}</h3><p className="mt-1 text-xs leading-5 text-ink-secondary">{fr ? "1. Imprimez l’exemplaire à signer (2 copies). 2. Chaque partie paraphe chaque page, écrit « Lu et approuvé », signe et date. 3. Scannez ou photographiez une copie signée et enregistrez-la ici : elle devient l’original du contrat." : "1. Print the copy to sign (2 copies). 2. Each party initials every page, writes “Read and approved”, signs and dates. 3. Scan or photograph one signed copy and record it here: it becomes the contract original."}</p></div>
      <div className="flex flex-wrap gap-2"><a href={orgApiUrl(orgSlug, `contracts/${contractId}/workspace/print`)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 py-2 text-xs font-semibold text-ink hover:border-border-strong hover:bg-surface-2"><Download className="size-3.5" />{fr ? "Imprimer l’exemplaire à signer" : "Print the copy to sign"}</a><Button size="sm" variant="secondary" onClick={() => setOpen((value) => !value)}><Upload />{fr ? "Enregistrer le contrat signé" : "Record the signed contract"}</Button></div>
    </div>
    {open ? <form className="grid gap-3 border-t border-border bg-surface-2/50 px-4 py-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); record.mutate(new FormData(event.currentTarget)); }}>
      <Field label={fr ? "Date de signature" : "Signature date"} required><Input name="signedOn" type="date" required max={today} defaultValue={today} /></Field>
      <Field label={fr ? "Signé pour l’employeur par" : "Signed for the employer by"} required hint={fr ? "Nom complet de la personne qui a signé pour l’entreprise." : "Full name of the person who signed for the company."}><Input name="employerSignerName" required minLength={2} /></Field>
      <Field label={fr ? "Contrat signé scanné" : "Scanned signed contract"} required hint={fr ? "PDF (recommandé) ou photo JPEG / PNG de toutes les pages." : "PDF (recommended) or JPEG / PNG photo of every page."}><Input name="file" type="file" required accept="application/pdf,image/jpeg,image/png" /></Field>
      <Field label={fr ? "Note (facultatif)" : "Note (optional)"}><Input name="note" maxLength={500} placeholder={fr ? "Ex. original rangé au dossier RH" : "e.g. original kept in the HR file"} /></Field>
      <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-ink-secondary">{fr ? "Le contrat passera à « Actif ». Les signatures électroniques en attente sont remplacées par cet exemplaire." : "The contract becomes Active. Pending electronic signatures are replaced by this copy."}</p><Button type="submit" loading={record.isPending}><ShieldCheck />{fr ? "Enregistrer comme signé" : "Record as signed"}</Button></div>
      {record.error ? <p className="sm:col-span-2 text-xs text-critical">{(record.error as Error).message}</p> : null}
    </form> : null}
  </section>;
}
function TemplateForm({ fr, orgSlug, template, preset: initialPreset = null, onClose }: { fr: boolean; orgSlug: string; template: ContractTemplate | null; preset?: ReadyContractTemplate | null; onClose: () => void }) {
  const [preset, setPreset] = useState<ReadyContractTemplate | null>(initialPreset);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  // Headings come back as « ## … » lines so editing a template never loses them.
  const existingContent = template
    ? (template.body?.blocks ?? []).slice(1).map((block) => block.type === "heading" ? `## ${block.text ?? ""}` : block.text ?? "").filter(Boolean).join("\n\n")
    : preset?.text ?? DEFAULT_EMPLOYMENT_CONTRACT_TEXT;
  const save = useMutation({
    mutationFn: (body: unknown) => template ? patch(orgUrl(orgSlug, `contracts/templates/${template.id}`), body) : post(orgUrl(orgSlug, "contracts/templates"), body),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["contract-templates", orgSlug] }); onClose(); },
    onError: (reason: Error) => setError(reason.message),
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    setError(null);
    save.mutate({
      name,
      code: String(data.get("code") ?? "").trim().toLowerCase(),
      contractType: String(data.get("contractType") ?? "employment"),
      language: String(data.get("language") ?? "fr"),
      isActive: data.get("isActive") === "on",
      body: { blocks: templateBlocks(name, String(data.get("body") ?? "")) },
    });
  };
  return <div className="fixed inset-0 z-[60] overflow-y-auto bg-slate-950/55 p-3 backdrop-blur-sm sm:p-6"><form onSubmit={submit} className="mx-auto my-6 max-w-2xl overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-2xl">
    <div className="flex items-start justify-between gap-4 border-b border-border bg-[linear-gradient(110deg,rgba(20,184,166,.12),transparent_58%)] px-5 py-5"><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-brand">{fr ? "Bibliothèque de modèles" : "Template library"}</p><h2 className="mt-1 text-lg font-semibold text-ink">{template ? (fr ? "Modifier le modèle" : "Edit template") : (fr ? "Créer un modèle" : "Create template")}</h2><p className="mt-1 max-w-xl text-xs leading-5 text-ink-secondary">{fr ? "Les champs {{employee.fullName}} et {{contract.startDate}} sont remplis de façon sécurisée à la génération. Une modification s’applique uniquement aux prochaines versions générées." : "Fields such as {{employee.fullName}} and {{contract.startDate}} are securely filled during generation. Changes only apply to future generated versions."}</p></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-ink-secondary hover:bg-surface-3" aria-label={fr ? "Fermer" : "Close"}><X /></button></div>
    <div className="space-y-5 p-5">
      {error ? <div className="rounded-xl border border-critical/30 bg-critical/10 p-3 text-sm text-critical">{error}</div> : null}
      {!template ? <Field label={fr ? "Partir de" : "Start from"} hint={fr ? "Remplit le nom, le code et le texte ; vous pouvez ensuite tout ajuster." : "Fills the name, code and text; you can then adjust everything."}><select className={selectClass} value={preset?.key ?? ""} onChange={(event) => setPreset(READY_CONTRACT_TEMPLATES.find((item) => item.key === event.target.value) ?? null)}><option value="">{fr ? "Contrat de travail général LiteHubs" : "General LiteHubs employment contract"}</option>{READY_CONTRACT_TEMPLATES.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select></Field> : null}
      <div key={preset?.key ?? "general"} className="space-y-5"><div className="grid gap-4 sm:grid-cols-2"><Field label={fr ? "Nom du modèle" : "Template name"} required><Input name="name" required defaultValue={template?.name ?? preset?.name ?? ""} /></Field><Field label={fr ? "Code unique" : "Unique code"} hint={fr ? "Lettres minuscules, chiffres, tirets ou underscores." : "Lowercase letters, numbers, hyphens or underscores."} required><Input name="code" required defaultValue={template?.code ?? preset?.code ?? ""} placeholder="contrat_travail_v1" /></Field><Field label={fr ? "Type" : "Type"} required><select name="contractType" className={selectClass} defaultValue={template?.contractType ?? "employment"}>{["employment", "service", "supply", "sales", "lease", "loan", "insurance", "nda", "other"].map((item) => <option key={item} value={item}>{contractTypeText(item, fr)}</option>)}</select></Field><Field label={fr ? "Langue" : "Language"}><select name="language" className={selectClass} defaultValue={template?.language ?? "fr"}><option value="fr">Français</option><option value="en">English</option></select></Field></div>
      <Field label={fr ? "Clauses et contenu" : "Clauses and content"} hint={fr ? "« ## Article … » crée un titre, **texte** met en gras, « 1. » crée une liste. Champs remplis automatiquement : {{company.name}}, {{company.address}}, {{employee.fullName}}, {{employee.employeeNumber}}, {{employee.jobTitle}}, {{employee.workLocation}}, {{contract.startDate}}, {{contract.endDate}}, {{contract.salary}}, {{contract.currency}}, {{contract.paymentTerms}}, {{contract.employerSignerRole}}. Ne mettez pas de bloc de signature : il est ajouté automatiquement à la fin." : "“## Article …” makes a heading, **text** is bold, “1.” makes a list. Merge fields are filled automatically. Do not add a signature block: it is added automatically at the end."} required><Textarea name="body" required rows={18} defaultValue={existingContent} placeholder={fr ? "Utilisez {{employee.fullName}}, {{contract.startDate}}, {{contract.endDate}}, {{contract.salary}} et {{contract.currency}}." : "Use {{employee.fullName}}, {{contract.startDate}}, {{contract.endDate}}, {{contract.salary}} and {{contract.currency}}."} /></Field></div>
      <label className="flex items-start gap-3 rounded-xl border border-border bg-surface-2/45 p-3 text-sm text-ink"><input name="isActive" type="checkbox" defaultChecked={template?.isActive ?? true} className="mt-0.5 size-4 accent-brand" /><span><b>{fr ? "Modèle actif" : "Active template"}</b><span className="mt-0.5 block text-xs leading-5 text-ink-secondary">{fr ? "Décochez pour archiver : le modèle reste dans l’historique, mais ne peut plus servir pour une nouvelle version de contrat." : "Clear this to archive it: it stays in history but cannot be used for a new contract version."}</span></span></label>
    </div>
    <div className="flex justify-end gap-2 border-t border-border bg-surface-2 px-5 py-4"><Button type="button" variant="secondary" onClick={onClose}>{fr ? "Annuler" : "Cancel"}</Button><Button type="submit" loading={save.isPending}>{template ? (fr ? "Enregistrer les modifications" : "Save changes") : (fr ? "Enregistrer le modèle" : "Save template")}</Button></div>
  </form></div>;
}