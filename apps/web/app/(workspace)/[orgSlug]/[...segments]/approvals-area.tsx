"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  Landmark,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { ApiError, get, orgUrl, post } from "@/lib/api";
import { can } from "@/lib/permissions";
import { formatInstant, formatMoney } from "@/lib/utils";
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

function titleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusVariant(status: ApprovalStatus) {
  if (status === "approved") return "good" as const;
  if (status === "rejected") return "serious" as const;
  if (status === "partially_approved") return "warning" as const;
  if (status === "pending") return "info" as const;
  return "neutral" as const;
}

export function ApprovalsArea({ orgSlug }: { orgSlug: string }) {
  const { locale, t } = useLanguage();
  const user = useSessionUser();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<ApprovalStatus | "">("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [decisionNotes, setDecisionNotes] = useState("");
  const [approvedAmount, setApprovedAmount] = useState("");
  const canRead = can(user, "approvals.read");
  const canApprove = can(user, "approvals.approve");
  const canReject = can(user, "approvals.reject");
  const copy =
    locale === "fr"
      ? {
          kicker: "Contrôle financier",
          heading: "Approbations",
          description:
            "Décidez des achats, dépenses, travaux et étapes de projet avant que l’argent ou les ressources soient engagés.",
          pending: "En attente",
          pendingValue: "Valeur en attente",
          approved: "Approuvées",
          rejected: "Refusées",
          all: "Toutes les décisions",
          list: "File de décisions",
          select:
            "Sélectionnez une demande pour contrôler son contexte et prendre une décision.",
          details: "Détail de la demande",
          requested: "Demandée par",
          project: "Projet",
          type: "Type",
          amount: "Montant demandé",
          requestedAt: "Demandée le",
          decision: "Décision",
          decisionNotes: "Note de décision",
          decisionHint:
            "Expliquez la décision. Cette note reste dans l’historique de l’entreprise.",
          approvedAmount: "Montant approuvé",
          approve: "Approuver",
          partial: "Approuver partiellement",
          reject: "Refuser",
          noApprovals: "Aucune demande ne correspond à ce filtre.",
          noAccess: "Votre rôle ne permet pas de consulter les approbations.",
          failed: "La décision n’a pas pu être enregistrée.",
          automatic:
            "Les demandes apparaissent automatiquement lorsqu’un achat ou une dépense est soumis, lorsqu’un travail de maintenance attend une décision, ou lorsqu’une étape de projet demande sa validation.",
        }
      : {
          kicker: "Financial control",
          heading: "Approvals",
          description:
            "Decide on purchases, expenses, work and project phases before money or resources are committed.",
          pending: "Pending",
          pendingValue: "Pending value",
          approved: "Approved",
          rejected: "Rejected",
          all: "All decisions",
          list: "Decision queue",
          select: "Select a request to review the context and make a decision.",
          details: "Request details",
          requested: "Requested by",
          project: "Project",
          type: "Type",
          amount: "Amount requested",
          requestedAt: "Requested",
          decision: "Decision",
          decisionNotes: "Decision note",
          decisionHint:
            "Explain the decision. This note remains in the company history.",
          approvedAmount: "Approved amount",
          approve: "Approve",
          partial: "Partially approve",
          reject: "Reject",
          noApprovals: "No requests match this filter.",
          noAccess: "Your role does not allow you to view approvals.",
          failed: "The decision could not be saved.",
          automatic:
            "Requests appear automatically when a purchase or expense is submitted, a maintenance work order needs a decision, or a project phase asks for sign-off.",
        };

  const approvals = useQuery({
    queryKey: ["approvals", orgSlug],
    queryFn: () =>
      get<{ resource: "approvals"; records: Approval[] }>(
        orgUrl(orgSlug, "owner-management/approvals?limit=200"),
      ),
    enabled: canRead,
  });
  const detail = useQuery({
    queryKey: ["approval", orgSlug, selectedId],
    queryFn: () =>
      get<{ record: Approval }>(
        orgUrl(orgSlug, `owner-management/approvals/${selectedId}`),
      ),
    enabled: canRead && Boolean(selectedId),
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["approvals", orgSlug] });
    if (selectedId)
      queryClient.invalidateQueries({
        queryKey: ["approval", orgSlug, selectedId],
      });
  };
  const decide = useMutation({
    mutationFn: ({
      approvalId,
      decision,
    }: {
      approvalId: string;
      decision: Decision;
    }) => {
      const amount = Number(approvedAmount);
      return post<{ approval: Approval }>(
        orgUrl(orgSlug, `owner-management/approvals/${approvalId}/decide`),
        {
          decision,
          ...(decisionNotes.trim()
            ? { decisionNotes: decisionNotes.trim() }
            : {}),
          ...(decision === "partially_approved"
            ? { approvedAmount: amount }
            : {}),
        },
      );
    },
    onSuccess: () => {
      setDecisionNotes("");
      setApprovedAmount("");
      refresh();
    },
  });

  const records = approvals.data?.records ?? [];
  const displayed = useMemo(
    () =>
      filter ? records.filter((record) => record.status === filter) : records,
    [filter, records],
  );
  const selected =
    detail.data?.record ??
    records.find((record) => record.id === selectedId) ??
    null;
  const pending = records.filter((record) => record.status === "pending");
  const pendingValue = pending.reduce(
    (total, record) => total + Number(record.requestedAmount ?? 0),
    0,
  );
  const approvalCurrency =
    pending.find((record) => record.currencyCode)?.currencyCode ?? "CDF";
  const error =
    decide.error instanceof ApiError
      ? decide.error.message
      : decide.error
        ? copy.failed
        : null;
  const partialAmount = Number(approvedAmount);
  const canSubmitPartial =
    approvedAmount.trim() !== "" &&
    Number.isFinite(partialAmount) &&
    partialAmount >= 0;

  function select(approval: Approval) {
    setSelectedId(approval.id);
    setDecisionNotes(approval.decisionNotes ?? "");
    setApprovedAmount(
      approval.requestedAmount === null ? "" : String(approval.requestedAmount),
    );
  }

  if (!canRead)
    return (
      <main className="grid min-h-[60dvh] place-items-center p-6">
        <div className="max-w-md text-center">
          <ClipboardCheck
            className="mx-auto size-9 text-ink-muted"
            aria-hidden
          />
          <h1 className="mt-3 text-lg font-semibold text-ink">
            {t("nav.approvals")}
          </h1>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">
            {copy.noAccess}
          </p>
        </div>
      </main>
    );

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <section className="overflow-hidden rounded-2xl bg-[radial-gradient(circle_at_88%_8%,rgba(250,204,21,.22),transparent_28%),linear-gradient(125deg,#10314f_0%,#17665d_58%,#1b8b7a_100%)] px-5 py-7 text-white sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-emerald-100">
              {copy.kicker}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-.03em]">
              {t("nav.approvals")}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-emerald-50/90">
              {copy.description}
            </p>
          </div>
          <div className="rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-emerald-50">
            <FileCheck2 className="mb-2 size-5" aria-hidden />
            <span className="block max-w-56 leading-5">{copy.automatic}</span>
          </div>
        </div>
        <div className="mt-6 grid max-w-4xl gap-3 sm:grid-cols-4">
          <Metric label={copy.pending} value={pending.length} />
          <Metric
            label={copy.pendingValue}
            value={formatMoney(pendingValue, approvalCurrency, {
              compact: true,
            })}
          />
          <Metric
            label={copy.approved}
            value={
              records.filter((record) => record.status === "approved").length
            }
          />
          <Metric
            label={copy.rejected}
            value={
              records.filter((record) => record.status === "rejected").length
            }
          />
        </div>
      </section>
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-critical/35 bg-critical/10 px-3 py-2 text-sm text-critical"
        >
          {error}
        </p>
      ) : null}
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,.85fr)]">
        <div className="overflow-hidden rounded-2xl border border-border bg-surface-1">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-ink">{copy.list}</h2>
              <p className="mt-0.5 text-xs text-ink-secondary">
                {displayed.length}{" "}
                {filter === "pending"
                  ? copy.pending.toLowerCase()
                  : copy.all.toLowerCase()}
              </p>
            </div>
            <select
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value as ApprovalStatus | "");
                setSelectedId(null);
              }}
              aria-label={copy.all}
              className="h-8 rounded-md border border-border bg-surface-1 px-2 text-xs text-ink"
            >
              <option value="">{copy.all}</option>
              {(
                [
                  "pending",
                  "approved",
                  "partially_approved",
                  "rejected",
                  "cancelled",
                ] as ApprovalStatus[]
              ).map((status) => (
                <option key={status} value={status}>
                  {titleCase(status)}
                </option>
              ))}
            </select>
          </div>
          {approvals.isPending ? (
            <div className="space-y-3 p-5">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          ) : approvals.isError ? (
            <ErrorState
              description={copy.failed}
              onRetry={() => approvals.refetch()}
            />
          ) : displayed.length ? (
            <div className="divide-y divide-border">
              {displayed.map((approval) => (
                <button
                  type="button"
                  key={approval.id}
                  onClick={() => select(approval)}
                  className={`flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-surface-2 ${selectedId === approval.id ? "bg-brand-subtle" : ""}`}
                >
                  <div
                    className={`grid size-10 shrink-0 place-items-center rounded-full ${approval.status === "pending" ? "bg-brand-subtle text-brand" : approval.status === "rejected" ? "bg-critical/10 text-critical" : "bg-good/10 text-good"}`}
                  >
                    <Landmark className="size-4" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-ink">
                        {approval.approvalNumber}
                      </p>
                      <Badge variant={statusVariant(approval.status)}>
                        {titleCase(approval.status)}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-ink-secondary">
                      {titleCase(approval.requestType)} ·{" "}
                      {approval.projectName ??
                        approval.projectCode ??
                        approval.entityType}
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {approval.requestedByName ?? "—"} ·{" "}
                      {formatInstant(
                        approval.requestedAt ?? approval.createdAt,
                      )}
                    </p>
                  </div>
                  <div className="hidden text-right sm:block">
                    <p className="text-sm font-semibold tabular-nums text-ink">
                      {formatMoney(
                        approval.requestedAmount,
                        approval.currencyCode,
                      )}
                    </p>
                  </div>
                  <ChevronRight
                    className="size-4 shrink-0 text-ink-muted"
                    aria-hidden
                  />
                </button>
              ))}
            </div>
          ) : (
            <div className="p-10 text-center">
              <ClipboardCheck
                className="mx-auto size-8 text-ink-muted"
                aria-hidden
              />
              <p className="mt-3 text-sm text-ink-secondary">
                {copy.noApprovals}
              </p>
            </div>
          )}
        </div>
        <ApprovalDetail
          item={selected}
          pending={detail.isPending}
          copy={copy}
          notes={decisionNotes}
          setNotes={setDecisionNotes}
          amount={approvedAmount}
          setAmount={setApprovedAmount}
          canApprove={canApprove}
          canReject={canReject}
          partialValid={canSubmitPartial}
          working={decide.isPending}
          onDecide={(decision) =>
            selected && decide.mutate({ approvalId: selected.id, decision })
          }
        />
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
      <p className="text-xs font-medium text-emerald-100">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
        {value}
      </p>
    </div>
  );
}

function ApprovalDetail({
  item,
  pending,
  copy,
  notes,
  setNotes,
  amount,
  setAmount,
  canApprove,
  canReject,
  partialValid,
  working,
  onDecide,
}: {
  item: Approval | null;
  pending: boolean;
  copy: {
    details: string;
    select: string;
    requested: string;
    project: string;
    type: string;
    amount: string;
    requestedAt: string;
    decision: string;
    decisionNotes: string;
    decisionHint: string;
    approvedAmount: string;
    approve: string;
    partial: string;
    reject: string;
  };
  notes: string;
  setNotes: (value: string) => void;
  amount: string;
  setAmount: (value: string) => void;
  canApprove: boolean;
  canReject: boolean;
  partialValid: boolean;
  working: boolean;
  onDecide: (decision: Decision) => void;
}) {
  if (pending)
    return (
      <aside className="rounded-2xl border border-border bg-surface-1 p-5">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-5 h-28" />
      </aside>
    );
  if (!item)
    return (
      <aside className="grid min-h-80 place-items-center rounded-2xl border border-dashed border-border-strong bg-surface-1 p-8 text-center">
        <div>
          <ClipboardCheck
            className="mx-auto size-8 text-ink-muted"
            aria-hidden
          />
          <h2 className="mt-3 text-sm font-semibold text-ink">
            {copy.details}
          </h2>
          <p className="mt-1 max-w-xs text-sm leading-6 text-ink-secondary">
            {copy.select}
          </p>
        </div>
      </aside>
    );
  const pendingDecision = item.status === "pending";
  return (
    <aside className="h-fit rounded-2xl border border-border bg-surface-1">
      <div className="border-b border-border p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusVariant(item.status)}>
            {titleCase(item.status)}
          </Badge>
          <Badge variant="outline" icon={false}>
            {titleCase(item.requestType)}
          </Badge>
        </div>
        <h2 className="mt-3 text-xl font-semibold tracking-tight text-ink">
          {item.approvalNumber}
        </h2>
        <p className="mt-1 text-sm text-ink-secondary">
          {item.projectName ?? item.projectCode ?? titleCase(item.entityType)}
        </p>
      </div>
      <div className="space-y-5 p-5">
        <dl className="grid gap-3 text-sm">
          <Detail label={copy.requested} value={item.requestedByName ?? "—"} />
          <Detail
            label={copy.project}
            value={item.projectName ?? item.projectCode ?? "—"}
          />
          <Detail label={copy.type} value={titleCase(item.requestType)} />
          <Detail
            label={copy.amount}
            value={formatMoney(item.requestedAmount, item.currencyCode)}
          />
          {item.approvedAmount !== null && item.approvedAmount !== undefined ? (
            <Detail
              label={copy.approvedAmount}
              value={formatMoney(item.approvedAmount, item.currencyCode)}
            />
          ) : null}
          <Detail
            label={copy.requestedAt}
            value={formatInstant(item.requestedAt ?? item.createdAt)}
          />
          {item.decidedAt ? (
            <Detail
              label={copy.decision}
              value={`${titleCase(item.status)} · ${formatInstant(item.decidedAt)}`}
            />
          ) : null}
        </dl>
        {item.requestNotes ? (
          <div className="rounded-lg bg-surface-2 px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {copy.type}
            </p>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              {item.requestNotes}
            </p>
          </div>
        ) : null}
        {item.decisionNotes ? (
          <div className="rounded-lg border border-good/20 bg-good/5 px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-good-ink">
              {copy.decisionNotes}
            </p>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              {item.decisionNotes}
            </p>
          </div>
        ) : null}
        {pendingDecision && (canApprove || canReject) ? (
          <div className="space-y-4 border-t border-border pt-5">
            <Field
              label={copy.decisionNotes}
              hint={copy.decisionHint}
              htmlFor="approval-notes"
            >
              <Textarea
                id="approval-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                maxLength={2000}
              />
            </Field>
            {canApprove ? (
              <Field
                label={copy.approvedAmount}
                hint={formatMoney(item.requestedAmount, item.currencyCode)}
                htmlFor="approval-amount"
              >
                <Input
                  id="approval-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </Field>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              {canApprove ? (
                <Button
                  size="sm"
                  onClick={() => onDecide("approved")}
                  loading={working}
                >
                  <Check aria-hidden />
                  {copy.approve}
                </Button>
              ) : null}
              {canApprove ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onDecide("partially_approved")}
                  loading={working}
                  disabled={!partialValid}
                >
                  <CircleDollarSign aria-hidden />
                  {copy.partial}
                </Button>
              ) : null}
              {canReject ? (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => onDecide("rejected")}
                  loading={working}
                  disabled={!notes.trim()}
                >
                  <X aria-hidden />
                  {copy.reject}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="max-w-[62%] text-right font-medium text-ink">{value}</dd>
    </div>
  );
}
