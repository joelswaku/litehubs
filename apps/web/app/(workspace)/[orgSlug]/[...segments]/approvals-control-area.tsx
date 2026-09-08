"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  BadgeDollarSign,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  Landmark,
  ReceiptText,
  Search,
  ShieldCheck,
  Wrench,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import {
  EmptyState,
  ErrorState,
  NoAccessState,
  SkeletonCard,
} from "@/components/ui/states";
import { ApiError, get, orgUrl, post } from "@/lib/api";
import { can } from "@/lib/permissions";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";

type ApprovalStatus =
  "pending" | "approved" | "rejected" | "partially_approved" | "cancelled";
type Decision = "approved" | "rejected" | "partially_approved";
type Approval = {
  id: string;
  approvalNumber: string;
  projectId: string | null;
  projectName?: string | null;
  projectCode?: string | null;
  entityType: string;
  entityId: string;
  requestType: string;
  requestedByMemberId: string;
  requestedByName?: string | null;
  requestedAmount: number | string | null;
  approvedAmount?: number | string | null;
  currencyCode: string | null;
  status: ApprovalStatus;
  requestedAt: string;
  createdAt: string;
  decidedAt: string | null;
  decidedByName?: string | null;
  requestNotes: string | null;
  decisionNotes: string | null;
};

const requestTypes = [
  "purchase_request",
  "expense",
  "material_adjustment",
  "asset_purchase",
  "asset_disposal",
  "maintenance_expense",
  "budget_increase",
  "phase_completion",
  "other",
] as const;
const t = (fr: boolean, en: string, frText: string) => (fr ? frText : en);
const title = (value: string | null | undefined) =>
  String(value ?? "—")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
const dateTime = (value: string | null | undefined, fr: boolean) =>
  value
    ? new Intl.DateTimeFormat(fr ? "fr-FR" : "en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
const money = (
  value: number | string | null | undefined,
  currency: string | null | undefined,
  fr: boolean,
) =>
  new Intl.NumberFormat(fr ? "fr-FR" : "en-US", {
    style: "currency",
    currency: /^[A-Z]{3}$/.test(String(currency)) ? String(currency) : "USD",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
const issue = (error: unknown, fr: boolean) =>
  error instanceof ApiError
    ? (Object.values(error.fieldErrors).flat()[0] ?? error.message)
    : error
      ? t(
          fr,
          "The decision could not be saved.",
          "La décision n’a pas pu être enregistrée.",
        )
      : null;
const statusVariant = (
  value: ApprovalStatus,
): "good" | "warning" | "serious" | "info" | "outline" =>
  value === "approved"
    ? "good"
    : value === "rejected"
      ? "serious"
      : value === "partially_approved"
        ? "warning"
        : value === "pending"
          ? "info"
          : "outline";
const typeIcon = (value: string) =>
  value === "expense" || value === "budget_increase"
    ? BadgeDollarSign
    : value === "purchase_request" || value === "asset_purchase"
      ? ReceiptText
      : value === "maintenance_expense"
        ? Wrench
        : Landmark;
const relatedPath = (orgSlug: string, type: string) =>
  type === "purchase_request" || type === "asset_purchase"
    ? `/${orgSlug}/procurement`
    : type === "expense" || type === "budget_increase"
      ? `/${orgSlug}/projects`
      : type === "maintenance_expense"
        ? `/${orgSlug}/maintenance`
        : `/${orgSlug}/projects`;

export function ApprovalsControlArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const user = useSessionUser();
  const client = useQueryClient();
  const canRead = can(user, "approvals.read");
  const canApprove = can(user, "approvals.approve");
  const canReject = can(user, "approvals.reject");
  const [status, setStatus] = useState<ApprovalStatus | "all">("pending");
  const [type, setType] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Decision | null>(null);
  const [notes, setNotes] = useState("");
  const [amount, setAmount] = useState("");
  const approvals = useQuery({
    queryKey: ["approvals-control", orgSlug],
    queryFn: () =>
      get<{ resource: "approvals"; records: Approval[] }>(
        orgUrl(orgSlug, "owner-management/approvals?limit=200"),
      ),
    enabled: canRead,
    select: (data) => data.records,
  });
  const detail = useQuery({
    queryKey: ["approval-control", orgSlug, selectedId],
    queryFn: () =>
      get<{ record: Approval }>(
        orgUrl(orgSlug, `owner-management/approvals/${selectedId}`),
      ),
    enabled: canRead && Boolean(selectedId),
    select: (data) => data.record,
  });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: Decision }) => {
      const parsed = Number(amount);
      return post<{ approval: Approval }>(
        orgUrl(orgSlug, `owner-management/approvals/${id}/decide`),
        {
          decision,
          ...(notes.trim() ? { decisionNotes: notes.trim() } : {}),
          ...(decision === "partially_approved"
            ? { approvedAmount: parsed }
            : {}),
        },
      );
    },
    onSuccess: (data) => {
      setSelectedId(data.approval.id);
      setMode(null);
      setNotes("");
      setAmount("");
      void client.invalidateQueries({
        queryKey: ["approvals-control", orgSlug],
      });
      void client.invalidateQueries({
        queryKey: ["approval-control", orgSlug, data.approval.id],
      });
    },
  });
  const rows = approvals.data ?? [];
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      if (status !== "all" && row.status !== status) return false;
      if (type !== "all" && row.requestType !== type) return false;
      if (!query) return true;
      return [
        row.approvalNumber,
        row.projectName,
        row.projectCode,
        row.requestType,
        row.entityType,
        row.requestedByName,
      ].some((value) =>
        String(value ?? "")
          .toLocaleLowerCase()
          .includes(query),
      );
    });
  }, [rows, search, status, type]);
  useEffect(() => {
    if (!selectedId && filtered[0]) setSelectedId(filtered[0].id);
    if (selectedId && !rows.some((item) => item.id === selectedId))
      setSelectedId(null);
  }, [filtered, rows, selectedId]);
  const selected =
    detail.data ?? rows.find((item) => item.id === selectedId) ?? null;
  const pending = rows.filter((item) => item.status === "pending");
  const partial = rows.filter((item) => item.status === "partially_approved");
  const approved = rows.filter((item) => item.status === "approved");
  const requestedTotal = pending.reduce(
    (sum, item) => sum + Number(item.requestedAmount ?? 0),
    0,
  );
  const decisionProblem = issue(decide.error, fr);
  const partialAmount = Number(amount);
  const partialAllowed = Boolean(
    selected &&
    amount.trim() &&
    Number.isFinite(partialAmount) &&
    partialAmount >= 0 &&
    (selected.requestedAmount == null ||
      partialAmount <= Number(selected.requestedAmount)),
  );

  if (!canRead)
    return <NoAccessState what={t(fr, "approvals", "les approbations")} />;
  if (approvals.isPending)
    return (
      <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        <SkeletonCard rows={10} />
      </main>
    );
  if (approvals.isError)
    return (
      <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        <ErrorState
          description={issue(approvals.error, fr) ?? undefined}
          onRetry={() => void approvals.refetch()}
        />
      </main>
    );

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <header className="relative overflow-hidden rounded-3xl border border-emerald-300/20 bg-[radial-gradient(circle_at_91%_14%,rgba(251,191,36,.3),transparent_28%),radial-gradient(circle_at_11%_110%,rgba(55,200,168,.2),transparent_37%),linear-gradient(125deg,#0c2d43,#0f6159_54%,#137260)] px-5 py-7 text-white shadow-[0_28px_62px_-40px_rgba(4,48,42,.95)] sm:px-7 sm:py-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[.18em] text-emerald-100">
              {t(fr, "Decision governance", "Gouvernance des décisions")}
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              {t(fr, "Approvals", "Approbations")}
            </h1>
            <p className="mt-2 text-sm leading-6 text-emerald-50/90">
              {t(
                fr,
                "Review exactly what is being requested before money, stock or project progress is committed.",
                "Contrôlez précisément ce qui est demandé avant d’engager de l’argent, du stock ou l’avancement d’un projet.",
              )}
            </p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-emerald-50">
            <ShieldCheck className="mb-2 size-5" />
            <p className="max-w-52 leading-5">
              {t(
                fr,
                "Every decision records the person, amount, note and time.",
                "Chaque décision conserve la personne, le montant, la note et l’heure.",
              )}
            </p>
          </div>
        </div>
        <div className="mt-6 grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <HeroMetric
            label={t(fr, "Waiting for decision", "En attente de décision")}
            value={pending.length}
          />
          <HeroMetric
            label={t(fr, "Amount awaiting review", "Montant à examiner")}
            value={money(
              requestedTotal,
              pending.find((x) => x.currencyCode)?.currencyCode,
              fr,
            )}
          />
          <HeroMetric
            label={t(fr, "Partially approved", "Partiellement approuvées")}
            value={partial.length}
          />
          <HeroMetric
            label={t(fr, "Approved", "Approuvées")}
            value={approved.length}
          />
        </div>
      </header>
      <section className="rounded-2xl border border-border-strong/80 bg-surface-1 p-3 shadow-[0_14px_34px_-28px_rgba(15,23,42,.42)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t(
                fr,
                "Search number, project, requester or type…",
                "Rechercher un numéro, projet, demandeur ou type…",
              )}
              className="pl-9"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto">
            {(["pending", "all", "approved", "rejected"] as const).map(
              (item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    setStatus(item);
                    setSelectedId(null);
                  }}
                  className={`whitespace-nowrap rounded-xl border px-3 py-2 text-xs font-semibold transition ${status === item ? "border-brand bg-brand text-white shadow-sm" : "border-border bg-surface-1 text-ink-secondary hover:border-brand/35 hover:bg-brand-subtle hover:text-brand"}`}
                >
                  {item === "all" ? t(fr, "All", "Toutes") : title(item)}
                </button>
              ),
            )}
          </div>
          <select
            className="h-10 rounded-xl border border-border-strong bg-surface-1 px-3 text-sm font-medium text-ink shadow-sm"
            aria-label={t(fr, "Request type", "Type de demande")}
            value={type}
            onChange={(event) => {
              setType(event.target.value);
              setSelectedId(null);
            }}
          >
            <option value="all">
              {t(fr, "All request types", "Tous les types")}
            </option>
            {requestTypes.map((item) => (
              <option key={item} value={item}>
                {title(item)}
              </option>
            ))}
          </select>
        </div>
      </section>
      {decisionProblem ? (
        <p
          role="alert"
          className="rounded-xl border border-critical/30 bg-critical/10 px-4 py-3 text-sm text-critical"
        >
          {decisionProblem}
        </p>
      ) : null}
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,.75fr)]">
        <ApprovalList
          fr={fr}
          rows={filtered}
          selectedId={selectedId}
          onSelect={(item) => {
            setSelectedId(item.id);
            setMode(null);
            setNotes(item.decisionNotes ?? "");
            setAmount(
              item.requestedAmount == null ? "" : String(item.requestedAmount),
            );
          }}
        />
        <ApprovalDetail
          fr={fr}
          orgSlug={orgSlug}
          item={selected}
          pending={detail.isPending}
          detailError={issue(detail.error, fr)}
          canApprove={canApprove}
          canReject={canReject}
          mode={mode}
          setMode={(next) => {
            setMode(next);
            setNotes(selected?.decisionNotes ?? "");
            setAmount(
              selected?.requestedAmount == null
                ? ""
                : String(selected.requestedAmount),
            );
          }}
          notes={notes}
          setNotes={setNotes}
          amount={amount}
          setAmount={setAmount}
          partialAllowed={partialAllowed}
          working={decide.isPending}
          onDecide={(decision) =>
            selected && decide.mutate({ id: selected.id, decision })
          }
        />
      </section>
    </main>
  );
}

function HeroMetric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
      <p className="text-xs font-medium text-emerald-100">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
        {value}
      </p>
    </div>
  );
}
function ApprovalList({
  fr,
  rows,
  selectedId,
  onSelect,
}: {
  fr: boolean;
  rows: Approval[];
  selectedId: string | null;
  onSelect: (item: Approval) => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border-strong/80 bg-surface-1 shadow-[0_16px_38px_-30px_rgba(15,23,42,.46)]">
      <div className="flex items-center justify-between border-b border-border bg-[linear-gradient(115deg,rgba(20,184,166,.075),transparent_52%)] px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-ink">
            {t(fr, "Decision queue", "File de décision")}
          </h2>
          <p className="mt-1 text-xs text-ink-secondary">
            {rows.length} {t(fr, "request(s)", "demande(s)")}
          </p>
        </div>
        <Clock3 className="size-5 text-brand" />
      </div>
      {rows.length ? (
        <div className="divide-y divide-border">
          {rows.map((item) => {
            const Icon = typeIcon(item.requestType);
            return (
              <button
                type="button"
                key={item.id}
                onClick={() => onSelect(item)}
                className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-l-[3px] border-transparent px-5 py-4 text-left transition hover:bg-surface-2/75 ${selectedId === item.id ? "border-brand bg-brand-subtle/70 shadow-[inset_0_1px_0_rgba(20,184,166,.12)]" : "hover:border-brand/30"}`}
              >
                <span
                  className={`grid size-10 place-items-center rounded-xl ${item.status === "pending" ? "bg-brand/10 text-brand" : item.status === "rejected" ? "bg-critical/10 text-critical" : "bg-good/10 text-good"}`}
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">
                      {item.approvalNumber}
                    </span>
                    <Badge variant={statusVariant(item.status)}>
                      {title(item.status)}
                    </Badge>
                  </span>
                  <span className="mt-1 block truncate text-xs font-medium text-ink-secondary">
                    {title(item.requestType)} ·{" "}
                    {item.projectName ??
                      item.projectCode ??
                      title(item.entityType)}
                  </span>
                  <span className="mt-1 block truncate text-xs text-ink-muted">
                    {item.requestedByName ?? "—"} ·{" "}
                    {dateTime(item.requestedAt ?? item.createdAt, fr)}
                  </span>
                </span>
                <span className="text-right">
                  <span className="hidden text-sm font-semibold tabular-nums text-ink sm:block">
                    {item.requestedAmount == null
                      ? "—"
                      : money(item.requestedAmount, item.currencyCode, fr)}
                  </span>
                  <ChevronRight className="ml-auto mt-1 size-4 text-ink-muted" />
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="relative overflow-hidden px-6 py-14 text-center sm:px-10">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_50%_0%,rgba(20,184,166,.12),transparent_66%)]" />
          <div className="relative mx-auto grid size-14 place-items-center rounded-2xl border border-brand/25 bg-brand-subtle text-brand shadow-sm">
            <FileCheck2 className="size-6" />
          </div>
          <h3 className="relative mt-5 text-base font-semibold text-ink">
            {t(fr, "No approval found", "Aucune approbation trouvée")}
          </h3>
          <p className="relative mx-auto mt-2 max-w-md text-sm leading-6 text-ink-secondary">
            {t(
              fr,
              "Try another filter, or requests will appear here when a controlled operation is submitted.",
              "Essayez un autre filtre, ou les demandes apparaîtront ici lorsqu’une opération contrôlée est soumise.",
            )}
          </p>
          <span className="relative mt-5 inline-flex rounded-full border border-border bg-surface-2 px-3 py-1 text-xs font-medium text-ink-muted">
            {t(fr, "Your decision queue is up to date", "Votre file de décision est à jour")}
          </span>
        </div>
      )}
    </section>
  );
}

function ApprovalDetail({
  fr,
  orgSlug,
  item,
  pending,
  detailError,
  canApprove,
  canReject,
  mode,
  setMode,
  notes,
  setNotes,
  amount,
  setAmount,
  partialAllowed,
  working,
  onDecide,
}: {
  fr: boolean;
  orgSlug: string;
  item: Approval | null;
  pending: boolean;
  detailError: string | null;
  canApprove: boolean;
  canReject: boolean;
  mode: Decision | null;
  setMode: (value: Decision | null) => void;
  notes: string;
  setNotes: (value: string) => void;
  amount: string;
  setAmount: (value: string) => void;
  partialAllowed: boolean;
  working: boolean;
  onDecide: (decision: Decision) => void;
}) {
  if (pending)
    return (
      <aside className="rounded-2xl border border-border bg-surface-1 p-5">
        <SkeletonCard rows={7} />
      </aside>
    );
  if (detailError)
    return (
      <aside className="rounded-2xl border border-border bg-surface-1 p-5">
        <ErrorState description={detailError} />
      </aside>
    );
  if (!item)
    return (
      <aside className="grid min-h-[30rem] place-items-center rounded-2xl border border-dashed border-brand/35 bg-[radial-gradient(circle_at_50%_0%,rgba(20,184,166,.10),transparent_42%)] p-8 text-center">
        <div>
          <ClipboardCheck className="mx-auto size-9 text-ink-muted" />
          <h2 className="mt-3 font-semibold text-ink">
            {t(fr, "Request details", "Détails de la demande")}
          </h2>
          <p className="mt-2 max-w-xs text-sm leading-6 text-ink-secondary">
            {t(
              fr,
              "Select a request to review its financial and operational context.",
              "Sélectionnez une demande pour contrôler son contexte financier et opérationnel.",
            )}
          </p>
        </div>
      </aside>
    );
  const Icon = typeIcon(item.requestType);
  const awaiting = item.status === "pending";
  return (
    <aside className="h-fit overflow-hidden rounded-2xl border border-border-strong/80 bg-surface-1 shadow-[0_16px_38px_-30px_rgba(15,23,42,.46)] xl:sticky xl:top-5">
      <div className="border-b border-border p-5">
        <div className="flex items-start justify-between gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-brand/10 text-brand">
            <Icon className="size-5" />
          </span>
          <Badge variant={statusVariant(item.status)}>
            {title(item.status)}
          </Badge>
        </div>
        <h2 className="mt-4 text-xl font-semibold tracking-tight text-ink">
          {item.approvalNumber}
        </h2>
        <p className="mt-1 text-sm font-medium text-ink-secondary">
          {title(item.requestType)}
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          {item.projectName ?? item.projectCode ?? title(item.entityType)}
        </p>
      </div>
      <div className="space-y-5 p-5">
        <div className="grid grid-cols-2 gap-3">
          <Info
            label={t(fr, "Requested amount", "Montant demandé")}
            value={
              item.requestedAmount == null
                ? "—"
                : money(item.requestedAmount, item.currencyCode, fr)
            }
          />
          <Info
            label={t(fr, "Approved amount", "Montant approuvé")}
            value={
              item.approvedAmount == null
                ? "—"
                : money(item.approvedAmount, item.currencyCode, fr)
            }
          />
          <Info
            label={t(fr, "Requested by", "Demandée par")}
            value={item.requestedByName ?? "—"}
          />
          <Info
            label={t(fr, "Submitted", "Soumise le")}
            value={dateTime(item.requestedAt ?? item.createdAt, fr)}
          />
        </div>
        {item.requestNotes ? (
          <Note title={t(fr, "Requester’s note", "Note du demandeur")}>
            {item.requestNotes}
          </Note>
        ) : null}
        {item.decidedAt ? (
          <div className="rounded-xl border border-good/20 bg-good/5 p-4">
            <div className="flex items-center gap-2 text-good-ink">
              <CheckCircle2 className="size-4" />
              <p className="text-xs font-semibold uppercase tracking-wide">
                {t(fr, "Decision recorded", "Décision enregistrée")}
              </p>
            </div>
            <p className="mt-2 text-sm font-medium text-ink">
              {title(item.status)} · {item.decidedByName ?? "—"}
            </p>
            <p className="mt-1 text-xs text-ink-secondary">
              {dateTime(item.decidedAt, fr)}
            </p>
            {item.decisionNotes ? (
              <p className="mt-3 border-t border-good/15 pt-3 text-sm leading-6 text-ink-secondary">
                {item.decisionNotes}
              </p>
            ) : null}
          </div>
        ) : null}
        <Link
          href={relatedPath(orgSlug, item.requestType)}
          className="flex items-center justify-between rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm font-semibold text-ink transition hover:border-brand/40 hover:text-brand"
        >
          <span>
            {t(fr, "Open the related workspace", "Ouvrir l’espace concerné")}
          </span>
          <ArrowUpRight className="size-4" />
        </Link>
        {awaiting && (canApprove || canReject) ? (
          <DecisionPanel
            fr={fr}
            item={item}
            canApprove={canApprove}
            canReject={canReject}
            mode={mode}
            setMode={setMode}
            notes={notes}
            setNotes={setNotes}
            amount={amount}
            setAmount={setAmount}
            partialAllowed={partialAllowed}
            working={working}
            onDecide={onDecide}
          />
        ) : awaiting ? (
          <div className="rounded-xl border border-border bg-surface-2 p-4 text-sm leading-6 text-ink-secondary">
            {t(
              fr,
              "Your role can review this request but cannot make the final decision.",
              "Votre rôle peut consulter cette demande mais ne peut pas prendre la décision finale.",
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/85 bg-surface-2 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-ink" title={value}>
        {value}
      </p>
    </div>
  );
}
function Note({ title, children }: { title: string; children: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {title}
      </p>
      <p className="mt-2 text-sm leading-6 text-ink-secondary">{children}</p>
    </div>
  );
}
function DecisionPanel({
  fr,
  item,
  canApprove,
  canReject,
  mode,
  setMode,
  notes,
  setNotes,
  amount,
  setAmount,
  partialAllowed,
  working,
  onDecide,
}: {
  fr: boolean;
  item: Approval;
  canApprove: boolean;
  canReject: boolean;
  mode: Decision | null;
  setMode: (value: Decision | null) => void;
  notes: string;
  setNotes: (value: string) => void;
  amount: string;
  setAmount: (value: string) => void;
  partialAllowed: boolean;
  working: boolean;
  onDecide: (decision: Decision) => void;
}) {
  const content =
    mode === "approved"
      ? {
          title: t(fr, "Approve request", "Approuver la demande"),
          description: t(
            fr,
            "The full requested amount will be authorised and the connected record will move forward.",
            "Le montant complet sera autorisé et l’enregistrement concerné avancera dans son workflow.",
          ),
          action: t(fr, "Confirm approval", "Confirmer l’approbation"),
          icon: CheckCircle2,
        }
      : mode === "partially_approved"
        ? {
            title: t(
              fr,
              "Approve a controlled amount",
              "Approuver un montant contrôlé",
            ),
            description: t(
              fr,
              "Enter the amount authorised. The original request remains visible in the audit trail.",
              "Saisissez le montant autorisé. La demande initiale reste visible dans l’historique.",
            ),
            action: t(
              fr,
              "Confirm partial approval",
              "Confirmer l’approbation partielle",
            ),
            icon: BadgeDollarSign,
          }
        : mode === "rejected"
          ? {
              title: t(fr, "Reject this request", "Refuser cette demande"),
              description: t(
                fr,
                "A clear reason is mandatory so the requester knows what must change.",
                "Un motif clair est obligatoire pour que le demandeur sache ce qui doit changer.",
              ),
              action: t(fr, "Confirm rejection", "Confirmer le refus"),
              icon: XCircle,
            }
          : null;
  if (!content)
    return (
      <div className="border-t border-border pt-5">
        <p className="text-sm font-semibold text-ink">
          {t(fr, "Choose a decision", "Choisissez une décision")}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {canApprove ? (
            <Button size="sm" onClick={() => setMode("approved")}>
              <CheckCircle2 />
              {t(fr, "Approve", "Approuver")}
            </Button>
          ) : null}
          {canApprove ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setMode("partially_approved")}
            >
              <BadgeDollarSign />
              {t(fr, "Partial", "Partiel")}
            </Button>
          ) : null}
          {canReject ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setMode("rejected")}
            >
              <XCircle />
              {t(fr, "Reject", "Refuser")}
            </Button>
          ) : null}
        </div>
      </div>
    );
  const Icon = content.icon;
  const valid =
    mode === "approved" ||
    (mode === "partially_approved" ? partialAllowed : Boolean(notes.trim()));
  return (
    <div className="border-t border-border pt-5">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
          <Icon className="size-4" />
        </span>
        <div>
          <p className="text-sm font-semibold text-ink">{content.title}</p>
          <p className="mt-1 text-xs leading-5 text-ink-secondary">
            {content.description}
          </p>
        </div>
      </div>
      {mode === "partially_approved" ? (
        <Field
          htmlFor="approval-amount"
          label={t(fr, "Approved amount", "Montant approuvé")}
          hint={t(
            fr,
            "Cannot exceed the requested amount",
            "Ne peut pas dépasser le montant demandé",
          )}
          className="mt-4"
        >
          <Input
            id="approval-amount"
            type="number"
            min="0"
            max={
              item.requestedAmount == null
                ? undefined
                : Number(item.requestedAmount)
            }
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
      ) : null}
      <Field
        htmlFor="approval-decision-note"
        label={t(fr, "Decision note", "Note de décision")}
        required={mode === "rejected"}
        hint={t(
          fr,
          "This note becomes part of the permanent company record.",
          "Cette note devient partie intégrante du dossier permanent de l’entreprise.",
        )}
        className="mt-4"
      >
        <Textarea
          id="approval-decision-note"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={2000}
          rows={3}
          placeholder={
            mode === "rejected"
              ? t(
                  fr,
                  "Explain the reason for refusal",
                  "Expliquez le motif du refus",
                )
              : t(
                  fr,
                  "Optional context for the requester",
                  "Contexte facultatif pour le demandeur",
                )
          }
        />
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setMode(null)}
          disabled={working}
        >
          {t(fr, "Back", "Retour")}
        </Button>
        <Button
          size="sm"
          variant={mode === "rejected" ? "destructive" : "primary"}
          onClick={() => {
            if (mode) onDecide(mode);
          }}
          loading={working}
          disabled={!valid}
        >
          {content.action}
        </Button>
      </div>
    </div>
  );
}
