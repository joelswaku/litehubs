"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Download,
  FileText,
  Factory,
  FolderKanban,
  ImageIcon,
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
import { PhoneInput } from "@/components/ui/phone-input";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { api, ApiError, get, orgApiUrl, orgUrl } from "@/lib/api";
import { agricultureApi } from "@/lib/agriculture-api";
import {
  ownerManagementApi,
  type ManagementBody,
  type OwnerManagementResource,
} from "@/lib/owner-management-api";
import { can, isOwner } from "@/lib/permissions";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";

export type OperationsAreaKind =
  | "tasks"
  | "inventory"
  | "procurement"
  | "suppliers"
  | "equipment"
  | "maintenance"
  | "feed-mill";
type Row = Record<string, unknown> & { id: string };
type Place = {
  id: string;
  name: string;
  code?: string | null;
  provinceId?: string | null;
};
type Employee = {
  id: string;
  fullName: string;
  employeeNumber?: string | null;
  member?: { memberId?: string | null } | null;
};
type Option = { value: string; label: string };
type FieldType =
  | "text"
  | "number"
  | "date"
  | "textarea"
  | "select"
  | "combobox"
  | "checkbox"
  | "file";
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
  accept?: string;
};
type RecordsResponse = { records: Row[] };

const text = (value: unknown) => String(value ?? "").trim();
const amount = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const date = (value: unknown) => (value ? String(value).slice(0, 10) : "—");
const dateTime = (value: unknown, fr: boolean) => {
  const parsed = value ? new Date(String(value)) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return date(value);
  return parsed.toLocaleString(fr ? "fr-FR" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};
const today = () => new Date().toISOString().slice(0, 10);
const copy = (fr: boolean, en: string, french: string) => (fr ? french : en);

// Inventory keeps one shared catalogue. These dedicated category keys make the
// feed-mill boundary explicit: only feed ingredients can enter a recipe.
const FEED_INVENTORY_CATEGORIES = {
  rawMaterial: "Provenderie · matière première",
  additive: "Provenderie · additif / minéral",
  finished: "Provenderie · aliment fabriqué",
} as const;
const feedIngredientCategory = (category: unknown) => {
  const value = text(category).toLowerCase();
  return [
    FEED_INVENTORY_CATEGORIES.rawMaterial.toLowerCase(),
    FEED_INVENTORY_CATEGORIES.additive.toLowerCase(),
    // Existing records remain usable while companies move to the dedicated categories.
    "matière première alimentaire",
    "matiere premiere alimentaire",
    "feed raw material",
    "feed additive",
    "additif alimentaire",
    "additif & minéral",
  ].includes(value);
};
const feedFinishedCategory = (category: unknown) => {
  const value = text(category).toLowerCase();
  return [
    FEED_INVENTORY_CATEGORIES.finished.toLowerCase(),
    "aliment fabriqué",
    "aliment fabrique",
    "finished feed",
  ].includes(value);
};
const inventoryCategoryName = (category: unknown, fr: boolean) => {
  const value = text(category);
  if (value === FEED_INVENTORY_CATEGORIES.rawMaterial)
    return copy(
      fr,
      "Feed mill · raw material",
      "Provenderie · matière première",
    );
  if (value === FEED_INVENTORY_CATEGORIES.additive)
    return copy(
      fr,
      "Feed mill · additive / mineral",
      "Provenderie · additif / minéral",
    );
  if (value === FEED_INVENTORY_CATEGORIES.finished)
    return copy(
      fr,
      "Feed mill · finished feed",
      "Provenderie · aliment fabriqué",
    );
  return value || copy(fr, "Uncategorised", "Sans catégorie");
};
const feedInventoryCategoryOptions = (fr: boolean): Option[] => [
  {
    value: FEED_INVENTORY_CATEGORIES.rawMaterial,
    label: copy(
      fr,
      "Feed mill · raw material",
      "Provenderie · matière première",
    ),
  },
  {
    value: FEED_INVENTORY_CATEGORIES.additive,
    label: copy(
      fr,
      "Feed mill · additive / mineral",
      "Provenderie · additif / minéral",
    ),
  },
  {
    value: FEED_INVENTORY_CATEGORIES.finished,
    label: copy(
      fr,
      "Feed mill · finished feed",
      "Provenderie · aliment fabriqué",
    ),
  },
];
const procurementUnitOptions = (fr: boolean): Option[] => {
  const units: Array<[string, string]> = [
    ["unité", "unit"],
    ["pièce", "piece"],
    ["sac", "bag"],
    ["paquet", "pack"],
    ["boîte", "box"],
    ["kg", "kg"],
    ["g", "g"],
    ["tonne", "tonne"],
    ["litre", "litre"],
    ["mL", "mL"],
    ["m", "m"],
    ["m²", "m²"],
    ["m³", "m³"],
    ["heure", "hour"],
    ["jour", "day"],
    ["mois", "month"],
    ["forfait", "flat rate"],
    ["service", "service"],
  ];
  return units.map(([french, english]) => ({
    value: french,
    label: fr ? french : english,
  }));
};
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
const inventoryMovementLabel = (value: unknown, fr: boolean) => {
  const labels: Record<string, [string, string]> = {
    receipt: ["Receipt", "Réception"],
    issue: ["Issue", "Sortie"],
    return: ["Return to stock", "Retour en stock"],
    adjustment_in: ["Stock increase", "Ajustement entrant"],
    adjustment_out: ["Stock decrease", "Ajustement sortant"],
    transfer_in: ["Transfer in", "Transfert entrant"],
    transfer_out: ["Transfer out", "Transfert sortant"],
    maintenance_issue: ["Maintenance issue", "Sortie maintenance"],
  };
  const label = labels[text(value)];
  return label ? (fr ? label[1] : label[0]) : nice(value);
};
const inventoryMovementIsOutbound = (value: unknown) =>
  ["issue", "adjustment_out", "transfer_out", "maintenance_issue"].includes(
    text(value),
  );
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
const procurementStatusLabel = (value: unknown, fr: boolean) => {
  const labels: Record<string, [string, string]> = {
    draft: ["Draft", "Brouillon"],
    submitted: ["Awaiting approval", "En attente d’approbation"],
    pending_approval: ["Awaiting approval", "En attente d’approbation"],
    approved: ["Approved", "Approuvée"],
    rejected: ["Rejected", "Refusée"],
    cancelled: ["Cancelled", "Annulée"],
    sent: ["Sent", "Envoyé"],
    partially_received: ["Partially received", "Partiellement reçue"],
    received: ["Received", "Réceptionnée"],
    verified: ["Verified", "Vérifiée"],
  };
  const label = labels[text(value)];
  return label ? (fr ? label[1] : label[0]) : nice(value);
};

type ReceiptTransition = "received" | "verified" | "rejected" | "cancelled";
type ReceiptStatusInfo = {
  step: string;
  label: string;
  detail: string;
  impact: string;
};
const receiptStatusInfo = (value: unknown, fr: boolean): ReceiptStatusInfo => {
  const state = text(value) || "draft";
  const labels: Record<string, ReceiptStatusInfo> = fr
    ? {
        draft: {
          step: "1 · Préparer",
          label: "Brouillon",
          detail:
            "Ajoutez les quantités réellement livrées et le bon de livraison avant de confirmer.",
          impact: "Aucun impact budgétaire",
        },
        received: {
          step: "2 · Confirmer",
          label: "Réception confirmée",
          detail:
            "Les quantités acceptées sont figées. La réception passe de l’engagé au dépensé ; le paiement fournisseur reste séparé.",
          impact: "Budget mis à jour",
        },
        verified: {
          step: "3 · Vérifier",
          label: "Réception vérifiée",
          detail:
            "Le contrôle documentaire ou physique est terminé. Cette vérification n’ajoute aucun second montant.",
          impact: "Aucun double comptage",
        },
        rejected: {
          step: "Clôturée",
          label: "Livraison refusée",
          detail:
            "La livraison a été refusée avant confirmation. Les quantités restent à livrer sur le bon de commande.",
          impact: "Aucun impact budgétaire",
        },
        cancelled: {
          step: "Clôturée",
          label: "Réception annulée",
          detail:
            "Le BR est annulé. Sans paiement ni actif durable lié, son impact est retiré et le bon de commande reste à suivre.",
          impact: "Impact de réception annulé",
        },
      }
    : {
        draft: {
          step: "1 · Prepare",
          label: "Draft",
          detail:
            "Add the actual delivered quantities and delivery note before confirming.",
          impact: "No budget impact",
        },
        received: {
          step: "2 · Confirm",
          label: "Receipt confirmed",
          detail:
            "Accepted quantities are locked. The receipt moves the amount from committed to spent; supplier payment remains separate.",
          impact: "Budget updated",
        },
        verified: {
          step: "3 · Verify",
          label: "Receipt verified",
          detail:
            "The physical or document review is complete. Verification never adds a second amount.",
          impact: "No double-counting",
        },
        rejected: {
          step: "Closed",
          label: "Delivery refused",
          detail:
            "The delivery was refused before confirmation. The purchase order remains open for delivery.",
          impact: "No budget impact",
        },
        cancelled: {
          step: "Closed",
          label: "Receipt cancelled",
          detail:
            "This BR is cancelled. With no payment or durable asset linked, its receipt impact is removed and the purchase order remains to be followed up.",
          impact: "Receipt impact cancelled",
        },
      };
  return labels[state] ?? labels.draft!;
};
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
  risks: "projects",
  "quality-checks": "procurement",
  "project-closeouts": "projects",
  tasks: "tasks",
  "task-dependencies": "tasks",
  "budget-lines": "projects",
  materials: "projects",
  "material-movements": "projects",
  suppliers: "suppliers",
  "inventory-items": "inventory.items",
  warehouses: "inventory.warehouses",
  "stock-movements": "inventory.movements",
  "feed-batches": "inventory.nutrition",
  "feed-batch-inputs": "inventory.nutrition",
  "nutrition-profiles": "inventory.nutrition",
  "feed-recipes": "inventory.nutrition",
  "feed-recipe-lines": "inventory.nutrition",
  "feed-orders": "inventory.nutrition",
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
function ReturnPurchaseRequestDialog({
  request,
  pending,
  error,
  onClose,
  onConfirm,
  fr,
}: {
  request: Row;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (correctionNote?: string) => void;
  fr: boolean;
}) {
  const requestNumber = text(request.requestNumber) || text(request.id);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const correctionNote = text(
      new FormData(event.currentTarget).get("correctionNote"),
    );
    onConfirm(correctionNote || undefined);
  };
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="return-request-title"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-2xl border border-border bg-surface-1 p-5 shadow-2xl sm:p-6"
      >
        <p className="text-xs font-semibold uppercase tracking-[.12em] text-brand">
          {copy(fr, "Purchase request", "Demande d’achat")}
        </p>
        <h2
          id="return-request-title"
          className="mt-1 text-xl font-semibold text-ink"
        >
          {copy(fr, "Return to draft", "Retourner au brouillon")}
        </h2>
        <p className="mt-3 text-sm leading-6 text-ink-secondary">
          {copy(
            fr,
            `DA ${requestNumber} will be reopened for the requester to correct its articles or reason. The current approval stays in the audit history; submitting it again creates a new approval.`,
            `La demande ${requestNumber} sera rouverte afin que le demandeur corrige ses articles ou son motif. La décision actuelle reste dans l’historique ; une nouvelle soumission créera une nouvelle approbation.`,
          )}
        </p>
        <div className="mt-5">
          <Field
            htmlFor="correctionNote"
            label={copy(
              fr,
              "Correction note (optional)",
              "Message de correction (facultatif)",
            )}
            hint={copy(
              fr,
              "Explain precisely what must be corrected.",
              "Indiquez précisément ce qui doit être corrigé.",
            )}
          >
            <Textarea name="correctionNote" maxLength={2000} />
          </Field>
        </div>
        {error ? (
          <p
            className="mt-4 rounded-lg bg-critical/10 px-3 py-2 text-sm text-critical"
            role="alert"
          >
            {error instanceof Error
              ? error.message
              : copy(
                  fr,
                  "Could not return this request to draft",
                  "Impossible de retourner cette demande au brouillon",
                )}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={pending}
          >
            {copy(fr, "Cancel", "Annuler")}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending
              ? copy(fr, "Returning…", "Retour en cours…")
              : copy(fr, "Return to draft", "Retourner au brouillon")}
          </Button>
        </div>
      </form>
    </div>
  );
}
function ReceiptStatusDialog({
  receipt,
  nextStatus,
  pending,
  error,
  onClose,
  onConfirm,
  fr,
}: {
  receipt: Row;
  nextStatus: ReceiptTransition;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (notes?: string) => void;
  fr: boolean;
}) {
  const reference = text(receipt.receiptNumber) || text(receipt.id);
  const copyForStatus: Record<
    ReceiptTransition,
    { title: string; description: string; action: string }
  > = fr
    ? {
        received: {
          title: "Confirmer la réception",
          description:
            "Les articles réellement reçus seront figés. Le BR transfère alors son montant de l’engagé au dépensé. Il sera ensuite prêt pour le paiement fournisseur, qui n’ajoute aucun second coût au projet.",
          action: "Confirmer la réception",
        },
        verified: {
          title: "Vérifier la réception",
          description:
            "Confirmez que les quantités, le bon de livraison et les justificatifs ont été contrôlés. Cette étape est une validation d’audit : elle ne change pas une seconde fois le budget.",
          action: "Marquer vérifiée",
        },
        rejected: {
          title: "Refuser la livraison",
          description:
            "Utilisez cette étape lorsqu’aucun article de ce BR n’est accepté. La commande reste ouverte pour que le fournisseur livre ou corrige les articles.",
          action: "Refuser la livraison",
        },
        cancelled: {
          title: "Annuler la réception",
          description:
            "Annulez seulement un BR confirmé sans paiement fournisseur ni actif durable lié. La réception ne comptera plus comme dépensée et la commande restera à suivre.",
          action: "Annuler le BR",
        },
      }
    : {
        received: {
          title: "Confirm receipt",
          description:
            "The actual received items will be locked. The BR then moves its amount from committed to spent. It is ready for supplier payment afterwards, without adding a second project cost.",
          action: "Confirm receipt",
        },
        verified: {
          title: "Verify receipt",
          description:
            "Confirm that quantities, delivery note, and evidence were checked. This is an audit step and does not change the budget a second time.",
          action: "Mark verified",
        },
        rejected: {
          title: "Refuse delivery",
          description:
            "Use this when no item from this BR is accepted. The purchase order remains open for the supplier to deliver or correct the items.",
          action: "Refuse delivery",
        },
        cancelled: {
          title: "Cancel receipt",
          description:
            "Only cancel a confirmed BR with no supplier payment or durable asset linked. It will no longer count as spent and the purchase order remains to be followed up.",
          action: "Cancel BR",
        },
      };
  const content = copyForStatus[nextStatus];
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const notes = text(new FormData(event.currentTarget).get("notes"));
    onConfirm(notes || undefined);
  };
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="receipt-status-title"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-2xl border border-border bg-surface-1 p-5 shadow-2xl sm:p-6"
      >
        <p className="text-xs font-semibold uppercase tracking-[.12em] text-brand">
          {copy(fr, "Goods receipt · ", "Réception · ")}
          {reference}
        </p>
        <h2
          id="receipt-status-title"
          className="mt-1 text-xl font-semibold text-ink"
        >
          {content.title}
        </h2>
        <p className="mt-3 text-sm leading-6 text-ink-secondary">
          {content.description}
        </p>
        <div className="mt-5">
          <Field
            htmlFor="notes"
            label={copy(fr, "Note (optional)", "Note (facultative)")}
            hint={copy(
              fr,
              "Useful to explain a refusal, cancellation, or verification result.",
              "Utile pour expliquer un refus, une annulation ou le résultat de la vérification.",
            )}
          >
            <Textarea
              name="notes"
              defaultValue={text(receipt.notes)}
              maxLength={2000}
            />
          </Field>
        </div>
        {error ? (
          <p
            className="mt-4 rounded-lg bg-critical/10 px-3 py-2 text-sm text-critical"
            role="alert"
          >
            {error instanceof Error
              ? error.message
              : copy(
                  fr,
                  "Could not update this BR",
                  "Impossible de mettre à jour ce BR",
                )}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={pending}
          >
            {copy(fr, "Cancel", "Fermer")}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? copy(fr, "Saving…", "Enregistrement…") : content.action}
          </Button>
        </div>
      </form>
    </div>
  );
}
function Editor({
  title,
  subtitle,
  row,
  defaults,
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
  defaults?: ManagementBody;
  fields: FormField[];
  pending: boolean;
  error: unknown;
  close: () => void;
  save: (body: ManagementBody, files?: Record<string, File>) => void;
  fr: boolean;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: ManagementBody = {};
    const files: Record<string, File> = {};
    fields.forEach((field) => {
      const raw = form.get(field.key);
      if (field.type === "file") {
        if (raw instanceof File && raw.size > 0) files[field.key] = raw;
        return;
      }
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
    save(body, Object.keys(files).length ? files : undefined);
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
            const value =
              row?.[field.key] ??
              defaults?.[field.key] ??
              field.defaultValue ??
              "";
            const control =
              field.type === "textarea" ? (
                <Textarea
                  name={field.key}
                  defaultValue={text(value)}
                  required={field.required}
                />
              ) : field.type === "select" ? (
                <SelectControl field={field} value={value} />
              ) : field.type === "combobox" ? (
                <>
                  <Input
                    name={field.key}
                    list={`${field.key}-suggestions`}
                    defaultValue={text(value)}
                    placeholder={copy(
                      fr,
                      "Choose or enter a unit",
                      "Choisissez ou saisissez une unité",
                    )}
                    required={field.required}
                    invalid={Boolean(errors[field.key]?.length)}
                  />
                  <datalist id={`${field.key}-suggestions`}>
                    {(field.options ?? []).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </datalist>
                </>
              ) : field.type === "file" ? (
                <Input
                  name={field.key}
                  type="file"
                  accept={field.accept}
                  required={field.required}
                  invalid={Boolean(errors[field.key]?.length)}
                />
              ) : field.type === "checkbox" ? (
                <label className="flex h-9 items-center gap-2 rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink">
                  <input
                    type="checkbox"
                    name={field.key}
                    defaultChecked={Boolean(value)}
                  />
                  {copy(fr, "Enabled", "Activé")}
                </label>
              ) : field.key === "phone" ? (
                <PhoneInput
                  name={field.key}
                  defaultValue={text(value)}
                  required={field.required}
                  invalid={Boolean(errors[field.key]?.length)}
                  fr={fr}
                />
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
                  field.type === "textarea" || field.type === "file"
                    ? "sm:col-span-2"
                    : undefined
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
  variant = "list",
  className,
  openLabel = "Open",
  renderCard,
}: {
  rows: Row[];
  fields: string[];
  open?: (row: Row) => void;
  empty: ReactNode;
  variant?: "list" | "cards";
  className?: string;
  openLabel?: string;
  renderCard?: (row: Row, open: () => void) => ReactNode;
}) {
  if (!rows.length) return <>{empty}</>;
  return (
    <div
      className={
        variant === "cards"
          ? `max-h-[34rem] space-y-3 overflow-y-auto pr-1 ${className ?? ""}`
          : `divide-y divide-border ${className ?? ""}`
      }
    >
      {rows.map((row, index) => {
        const key = text(row.id) || `row-${index}`;
        if (variant === "cards" && renderCard)
          return <div key={key}>{renderCard(row, () => open?.(row))}</div>;
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
            className={
              variant === "cards"
                ? "group flex w-full items-start justify-between gap-3 rounded-xl border border-border bg-surface-1 px-4 py-3.5 text-left shadow-sm transition hover:-translate-y-px hover:border-brand/35 hover:bg-surface-2 hover:shadow-md"
                : "flex w-full items-start justify-between gap-3 py-3 text-left hover:bg-surface-2/70"
            }
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
              <span className="shrink-0 text-xs font-semibold text-brand group-hover:underline">
                {openLabel}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
type ProcurementRecordType = "request" | "order" | "receipt";
function ProcurementRecordsPanel({
  title,
  description,
  type,
  rows,
  relatedRows,
  relationKey,
  relatedLabel,
  empty,
  createLabel,
  onCreate,
  onAddItem,
  onEditItem,
  onReturnToDraft,
  canReturnToDraft,
  onReceiptStatusChange,
  projectLabelForRow,
  orgSlug,
  canDownload,
  fr,
}: {
  title: string;
  description: string;
  type: ProcurementRecordType;
  rows: Row[];
  relatedRows: Row[];
  relationKey: string;
  relatedLabel: string;
  empty: string;
  createLabel: string;
  onCreate?: () => void;
  onAddItem?: (row: Row) => void;
  onEditItem?: (row: Row) => void;
  onReturnToDraft?: (row: Row) => void;
  canReturnToDraft?: (row: Row) => boolean;
  onReceiptStatusChange?: (row: Row, status: ReceiptTransition) => void;
  projectLabelForRow?: (row: Row) => string;
  orgSlug: string;
  canDownload: boolean;
  fr: boolean;
}) {
  const [page, setPage] = useState(0);
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);
  const pageSize = 4;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visibleRows = rows.slice(
    safePage * pageSize,
    (safePage + 1) * pageSize,
  );
  const Icon =
    type === "request"
      ? ClipboardList
      : type === "order"
        ? ShoppingCart
        : Truck;
  const dateLabel =
    type === "request"
      ? copy(fr, "Required", "Nécessaire")
      : type === "order"
        ? copy(fr, "Expected", "Prévue")
        : copy(fr, "BR date", "Date du BR");

  return (
    <section className="overflow-hidden rounded-2xl border border-brand/20 bg-surface-1 shadow-[0_16px_38px_-30px_rgb(15_118_110_/_0.65)] ring-1 ring-brand/[0.035]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-surface-2/55 px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand ring-1 ring-brand/15">
            <Icon className="size-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            <p className="mt-1 max-w-xl text-xs leading-5 text-ink-secondary">
              {description}
            </p>
          </div>
        </div>
        {onCreate ? (
          <Button size="sm" onClick={onCreate}>
            <Plus className="size-4" />
            {createLabel}
          </Button>
        ) : null}
      </div>

      <div className="space-y-3 p-4 sm:p-5">
        {!rows.length ? (
          <EmptyState title={empty} />
        ) : (
          visibleRows.map((row, index) => {
            const key = text(row.id) || `${type}-${index}`;
            const heading =
              text(row.requestNumber) ||
              text(row.orderNumber) ||
              text(row.receiptNumber) ||
              text(row.name) ||
              "—";
            const status = text(row.status);
            const receiptStatus =
              type === "receipt" ? receiptStatusInfo(status, fr) : null;
            const connectedRows = relatedRows.filter(
              (item) => text(item[relationKey]) === text(row.id),
            );
            const relatedCount = connectedRows.length;
            const relevantDate =
              type === "request"
                ? row.requiredDate
                : type === "order"
                  ? row.expectedDeliveryDate
                  : row.receivedDate;
            const descriptionText = text(row.reason) || text(row.notes);
            const responsibleName =
              type === "receipt"
                ? text(row.receivedByName)
                : type === "order"
                  ? text(row.orderedByName)
                  : "";
            const projectLabel = projectLabelForRow?.(row);
            const canAddItem =
              Boolean(onAddItem) &&
              ((type === "request" && status === "draft") ||
                (type === "receipt" && status === "draft"));
            const canReturn =
              type === "request" &&
              Boolean(onReturnToDraft) &&
              Boolean(canReturnToDraft?.(row));
            return (
              <article
                key={key}
                className="rounded-xl border border-border bg-surface-1 p-4 shadow-sm transition-colors hover:border-brand/30 hover:bg-brand/[0.018]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold tracking-[-0.01em] text-ink">
                      {heading}
                    </p>
                    {descriptionText ? (
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-secondary">
                        {descriptionText}
                      </p>
                    ) : null}
                  </div>
                  <Badge variant={tone(status)}>
                    {receiptStatus?.label ?? procurementStatusLabel(status, fr)}
                  </Badge>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {relevantDate ? (
                    <span className="rounded-md bg-surface-2 px-2 py-1 text-ink-secondary">
                      {dateLabel} · {date(relevantDate)}
                    </span>
                  ) : null}
                  {responsibleName ? (
                    <span className="rounded-md bg-brand/7 px-2 py-1 font-medium text-brand">
                      {type === "receipt"
                        ? copy(fr, "BR owner", "Responsable du BR")
                        : copy(fr, "Ordered by", "Commandé par")}{" "}
                      · {responsibleName}
                    </span>
                  ) : null}
                  {projectLabel ? (
                    <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-brand/7 px-2 py-1 font-medium text-brand">
                      <FolderKanban className="size-3 shrink-0" />
                      <span className="truncate">
                        {copy(fr, "Project", "Projet")} · {projectLabel}
                      </span>
                    </span>
                  ) : null}
                  {relatedCount ? (
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedRecordId((current) =>
                          current === text(row.id) ? null : text(row.id),
                        )
                      }
                      aria-expanded={expandedRecordId === text(row.id)}
                      className="rounded-md bg-brand/7 px-2 py-1 font-medium text-brand transition-colors hover:bg-brand/12 focus:outline-none focus:ring-2 focus:ring-brand/30"
                    >
                      {relatedCount} {relatedLabel} · {copy(fr, "View", "Voir")}
                    </button>
                  ) : (
                    <span className="rounded-md bg-surface-2 px-2 py-1 text-ink-muted">
                      {copy(fr, "No items yet", "Aucun article")}
                    </span>
                  )}
                </div>

                {receiptStatus ? (
                  <div className="mt-3 rounded-lg border border-brand/15 bg-brand/[0.035] px-3 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.11em] text-brand">
                        {receiptStatus.step}
                      </span>
                      <span className="rounded-md bg-surface-1 px-2 py-1 text-[11px] font-semibold text-ink-secondary ring-1 ring-border">
                        {receiptStatus.impact}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-ink-secondary">
                      {receiptStatus.detail}
                    </p>
                  </div>
                ) : null}
                {connectedRows.length ? (
                  <div className="mt-3 rounded-lg border border-border bg-surface-2/55 px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedRecordId((current) =>
                          current === text(row.id) ? null : text(row.id),
                        )
                      }
                      className="flex w-full items-center justify-between gap-3 text-left"
                    >
                      <span className="text-[11px] font-semibold uppercase tracking-[0.11em] text-ink-muted">
                        {type === "request"
                          ? copy(fr, "Requested items", "Articles demandés")
                          : type === "order"
                            ? copy(fr, "Ordered items", "Articles commandés")
                            : copy(
                                fr,
                                "Received items",
                                "Articles réceptionnés",
                              )}
                      </span>
                      <span className="text-xs font-semibold text-brand">
                        {expandedRecordId === text(row.id)
                          ? copy(fr, "Close", "Réduire")
                          : copy(fr, "Open all", "Ouvrir tout")}
                      </span>
                    </button>
                    <div className="mt-2 space-y-1.5">
                      {(expandedRecordId === text(row.id)
                        ? connectedRows
                        : connectedRows.slice(0, 2)
                      ).map((item, itemIndex) => {
                        const itemName =
                          text(item.description) || text(item.name) || "—";
                        const quantity =
                          type === "request"
                            ? item.requestedQuantity
                            : type === "order"
                              ? item.orderedQuantity
                              : item.receivedQuantity;
                        const canEditItem =
                          type === "request" &&
                          status === "draft" &&
                          onEditItem;
                        return (
                          <div
                            key={text(item.id) || `${key}-item-${itemIndex}`}
                            className="flex items-center justify-between gap-3 rounded-md px-1 py-1 text-xs"
                          >
                            <span className="min-w-0 truncate text-ink-secondary">
                              {itemName}
                            </span>
                            <span className="flex shrink-0 items-center gap-2 font-medium text-ink">
                              <span>
                                {quantity === null || quantity === undefined
                                  ? "—"
                                  : `${amount(quantity)} ${text(item.unit) || copy(fr, "unit", "unité")}`}
                              </span>
                              {canEditItem ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => onEditItem(item)}
                                >
                                  {copy(fr, "Edit", "Modifier")}
                                </Button>
                              ) : null}
                            </span>
                          </div>
                        );
                      })}
                      {connectedRows.length > 2 &&
                      expandedRecordId !== text(row.id) ? (
                        <button
                          type="button"
                          onClick={() => setExpandedRecordId(text(row.id))}
                          className="pt-1 text-xs font-medium text-brand hover:underline"
                        >
                          +{connectedRows.length - 2}{" "}
                          {copy(fr, "more item(s)", "autre(s) article(s)")} ·{" "}
                          {copy(fr, "Open all", "Ouvrir tout")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {type === "receipt" && onReceiptStatusChange ? (
                      <>
                        {canAddItem ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => onAddItem?.(row)}
                          >
                            <Plus className="size-3.5" />
                            {copy(
                              fr,
                              "Add received item",
                              "Ajouter l’article reçu",
                            )}
                          </Button>
                        ) : null}
                        {status === "draft" ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() =>
                                onReceiptStatusChange(row, "received")
                              }
                            >
                              <CheckCircle2 className="size-3.5" />
                              {copy(
                                fr,
                                "Confirm receipt",
                                "Confirmer la réception",
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                onReceiptStatusChange(row, "rejected")
                              }
                            >
                              {copy(
                                fr,
                                "Refuse delivery",
                                "Refuser la livraison",
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                onReceiptStatusChange(row, "cancelled")
                              }
                            >
                              {copy(fr, "Cancel BR", "Annuler le BR")}
                            </Button>
                          </>
                        ) : null}
                        {status === "received" ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() =>
                                onReceiptStatusChange(row, "verified")
                              }
                            >
                              <CheckCircle2 className="size-3.5" />
                              {copy(fr, "Verify BR", "Vérifier le BR")}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                onReceiptStatusChange(row, "cancelled")
                              }
                            >
                              {copy(fr, "Cancel BR", "Annuler le BR")}
                            </Button>
                          </>
                        ) : null}
                        {status === "verified" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              onReceiptStatusChange(row, "cancelled")
                            }
                          >
                            {copy(fr, "Cancel BR", "Annuler le BR")}
                          </Button>
                        ) : null}
                        {["rejected", "cancelled"].includes(status) ? (
                          <span className="text-xs text-ink-muted">
                            {copy(fr, "This BR is closed", "Ce BR est clôturé")}
                          </span>
                        ) : null}
                      </>
                    ) : canAddItem ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onAddItem?.(row)}
                      >
                        <Plus className="size-3.5" />
                        {copy(fr, "Add item", "Ajouter un article")}
                      </Button>
                    ) : canReturn ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onReturnToDraft?.(row)}
                      >
                        {copy(fr, "Return to draft", "Retourner au brouillon")}
                      </Button>
                    ) : status === "submitted" ||
                      status === "pending_approval" ? (
                      <span className="text-xs text-ink-muted">
                        {copy(
                          fr,
                          "Locked while approval is pending",
                          "Verrouillée pendant l’approbation",
                        )}
                      </span>
                    ) : (
                      <span className="text-xs text-ink-muted">
                        {copy(
                          fr,
                          "No action required",
                          "Aucune action requise",
                        )}
                      </span>
                    )}
                    {canDownload && text(row.id) ? (
                      <a
                        href={orgApiUrl(
                          orgSlug,
                          `owner-management/procurement/${
                            type === "request"
                              ? "purchase-requests"
                              : type === "order"
                                ? "purchase-orders"
                                : "receipts"
                          }/${text(row.id)}/export.pdf`,
                        )}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-brand/25 bg-brand/5 px-2.5 text-xs font-semibold text-brand transition-colors hover:bg-brand/10 focus:outline-none focus:ring-2 focus:ring-brand/30"
                      >
                        <Download className="size-3.5" />
                        {copy(fr, "Download PDF", "Télécharger le PDF")}
                      </a>
                    ) : null}
                  </div>
                  <span className="text-xs text-ink-muted">
                    {type === "request"
                      ? copy(fr, "Business need", "Besoin d’achat")
                      : type === "order"
                        ? copy(
                            fr,
                            "Supplier commitment",
                            "Engagement fournisseur",
                          )
                        : copy(fr, "Stock receiving", "Réception de stock")}
                  </span>
                </div>
              </article>
            );
          })
        )}
      </div>

      {rows.length > pageSize ? (
        <div className="flex items-center justify-between gap-3 border-t border-border bg-surface-2/35 px-4 py-3 sm:px-5">
          <p className="text-xs text-ink-muted">
            {copy(fr, "Showing", "Affichage")} {safePage * pageSize + 1}–
            {Math.min((safePage + 1) * pageSize, rows.length)}{" "}
            {copy(fr, "of", "sur")} {rows.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              {copy(fr, "Previous", "Précédent")}
            </Button>
            <span className="text-xs font-medium text-ink-secondary">
              {safePage + 1}/{pageCount}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={safePage + 1 >= pageCount}
              onClick={() => setPage(safePage + 1)}
            >
              {copy(fr, "Next", "Suivant")}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
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
  rowsVariant = "list",
  rowsClassName,
  renderCard,
  afterSave,
  createOpenSignal,
  openDetail,
  editSignal,
  hideCreateAction = false,
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
  rowsVariant?: "list" | "cards";
  rowsClassName?: string;
  renderCard?: (row: Row, open: () => void) => ReactNode;
  afterSave?: (record: Row, files?: Record<string, File>) => Promise<void>;
  createOpenSignal?: number;
  openDetail?: (row: Row) => void;
  editSignal?: { requestId: number; row: Row | "new" } | null;
  hideCreateAction?: boolean;
}) {
  const user = useSessionUser();
  const client = useQueryClient();
  const [editor, setEditor] = useState<Row | "new" | null>(null);
  useEffect(() => {
    if (createOpenSignal === undefined) return;
    setEditor("new");
  }, [createOpenSignal]);
  useEffect(() => {
    if (!editSignal) return;
    setEditor(editSignal.row);
  }, [editSignal?.requestId]);
  const permission = permissions[resource];
  const create = can(user, `${permission}.create`);
  const showCreateAction = create && !hideCreateAction;
  const update = can(user, `${permission}.update`);
  const mutation = useMutation({
    mutationFn: async ({
      body,
      files,
    }: {
      body: ManagementBody;
      files?: Record<string, File>;
    }) => {
      const result =
        editor && editor !== "new"
          ? await ownerManagementApi.update<{ record: Row }>(
              orgSlug,
              resource,
              editor.id,
              body,
            )
          : await ownerManagementApi.create<{ record: Row }>(
              orgSlug,
              resource,
              body,
            );
      if (afterSave && result.record) await afterSave(result.record, files);
      return result;
    },
    onSuccess: () => {
      setEditor(null);
      void client.invalidateQueries({ queryKey: ["operations", orgSlug] });
      // Project receipts share the same warehouse register. Refresh the
      // project-scoped selector as soon as a warehouse is added or edited.
      if (resource === "warehouses") {
        void client.invalidateQueries({
          queryKey: ["project-warehouses", orgSlug],
        });
      }
    },
  });
  return (
    <>
      <Panel
        title={title}
        description={description}
        action={
          showCreateAction ? (
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
          open={openDetail ?? (update ? setEditor : undefined)}
          variant={rowsVariant}
          className={rowsClassName}
          openLabel={copy(fr, "Open", "Ouvrir")}
          renderCard={renderCard}
          empty={
            <EmptyState
              title={emptyTitle}
              description={emptyDescription}
              action={
                showCreateAction
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
              ? copy(
                  fr,
                  `Add ${formTitle ?? title}`,
                  `Ajouter ${formTitle ?? title}`,
                )
              : copy(
                  fr,
                  `Edit ${formTitle ?? title}`,
                  `Modifier ${formTitle ?? title}`,
                )
          }
          subtitle={formTitle ?? title}
          row={editor === "new" ? undefined : editor}
          fields={form}
          pending={mutation.isPending}
          error={mutation.error}
          close={() => setEditor(null)}
          save={(body, files) => mutation.mutate({ body, files })}
          fr={fr}
        />
      ) : null}
    </>
  );
}
function EquipmentAssetCard({
  orgSlug,
  asset,
  fields,
  open,
  fr,
}: {
  orgSlug: string;
  asset: Row;
  fields: string[];
  open: () => void;
  fr: boolean;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const images = useQuery({
    queryKey: ["equipment-images", orgSlug, asset.id],
    queryFn: () =>
      get<{ images: Row[] }>(
        orgUrl(orgSlug, `images/owner-management/assets/${asset.id}`),
      ),
    enabled: Boolean(asset.id),
    select: (data) => data.images,
  });
  // Project-linked assets receive the company "General" category. The title
  // marker keeps the equipment photo recognizable without touching other files.
  const photo = (images.data ?? []).find(
    (image) =>
      text(image.documentType) === "equipment_photo" ||
      text(image.title).endsWith(" · photo"),
  );
  const heading = text(asset.name) || text(asset.assetNumber) || "—";
  const previewUrl = photo
    ? orgApiUrl(orgSlug, `files/${photo.id}/preview`)
    : null;

  return (
    <>
      <article className="group flex items-stretch gap-3 rounded-xl border border-border bg-surface-1 p-3 shadow-sm transition hover:-translate-y-px hover:border-brand/35 hover:bg-surface-2 hover:shadow-md">
        {photo && previewUrl ? (
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="relative size-20 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-3 focus:outline-none focus:ring-2 focus:ring-brand/40 sm:size-24"
            aria-label={copy(
              fr,
              `Open photo of ${heading}`,
              `Ouvrir la photo de ${heading}`,
            )}
          >
            <img
              src={previewUrl}
              alt={text(photo.altText) || heading}
              className="size-full object-cover transition duration-200 group-hover:scale-[1.03]"
              loading="lazy"
            />
            <span className="absolute inset-x-0 bottom-0 bg-ink/65 px-1.5 py-1 text-[10px] font-semibold text-white">
              {copy(fr, "View", "Voir")}
            </span>
          </button>
        ) : (
          <div
            className="grid size-20 shrink-0 place-items-center rounded-lg border border-dashed border-border bg-brand/[0.045] text-brand sm:size-24"
            aria-label={copy(
              fr,
              "No equipment photo",
              "Aucune photo d’équipement",
            )}
          >
            <ImageIcon className="size-6" />
          </div>
        )}
        <button
          type="button"
          onClick={open}
          className="min-w-0 flex-1 text-left focus:outline-none"
        >
          <span className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink">
                {heading}
              </span>
              {text(asset.assetNumber) ? (
                <span className="mt-0.5 block text-xs font-medium text-brand">
                  {text(asset.assetNumber)}
                </span>
              ) : null}
            </span>
            <span className="shrink-0 text-xs font-semibold text-brand group-hover:underline">
              {copy(fr, "Open", "Ouvrir")}
            </span>
          </span>
          <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-secondary">
            {fields.map((field) => {
              const value = asset[field];
              if (value === null || value === undefined || value === "")
                return null;
              return (
                <span key={`${asset.id}-${field}`}>
                  {field === "status" ? (
                    <Badge variant={tone(value)}>{nice(value)}</Badge>
                  ) : (
                    `${nice(field)}: ${field.toLowerCase().includes("date") ? date(value) : String(value)}`
                  )}
                </span>
              );
            })}
          </span>
          {!photo && !images.isLoading ? (
            <span className="mt-2 block text-xs text-ink-muted">
              {copy(
                fr,
                "No photo yet — open to add one.",
                "Aucune photo — ouvrez pour en ajouter une.",
              )}
            </span>
          ) : null}
        </button>
      </article>
      {previewOpen && photo && previewUrl ? (
        <div
          className="fixed inset-0 z-[90] grid place-items-center bg-ink/65 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`equipment-photo-${asset.id}`}
          onMouseDown={() => setPreviewOpen(false)}
        >
          <section
            className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-3 border-b border-border bg-surface-2 px-5 py-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[.13em] text-brand">
                  {copy(fr, "Equipment photo", "Photo de l’équipement")}
                </p>
                <h2
                  id={`equipment-photo-${asset.id}`}
                  className="mt-1 truncate text-lg font-semibold text-ink"
                >
                  {heading}
                </h2>
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={() => setPreviewOpen(false)}
                aria-label={copy(fr, "Close", "Fermer")}
              >
                <X />
              </Button>
            </header>
            <div className="min-h-0 flex-1 overflow-auto bg-surface-3 p-4 sm:p-6">
              <img
                src={previewUrl}
                alt={text(photo.altText) || heading}
                className="mx-auto max-h-[72vh] max-w-full rounded-xl bg-surface-1 object-contain shadow-lg"
              />
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
function EquipmentAssetDetailDialog({
  orgSlug,
  asset,
  fr,
  onClose,
  onEdit,
  projects,
  suppliers,
  sites,
  provinces,
  employees,
}: {
  orgSlug: string;
  asset: Row;
  fr: boolean;
  onClose: () => void;
  onEdit?: () => void;
  projects: Row[];
  suppliers: Row[];
  sites: Place[];
  provinces: Place[];
  employees: Employee[];
}) {
  const images = useQuery({
    queryKey: ["equipment-images", orgSlug, asset.id],
    queryFn: () =>
      get<{ images: Row[] }>(
        orgUrl(orgSlug, `images/owner-management/assets/${asset.id}`),
      ),
    enabled: Boolean(asset.id),
    select: (data) => data.images,
  });
  const photo = (images.data ?? []).find(
    (image) =>
      text(image.documentType) === "equipment_photo" ||
      text(image.title).endsWith(" · photo"),
  );
  const photoUrl = photo
    ? orgApiUrl(orgSlug, `files/${photo.id}/preview`)
    : null;
  const project = projects.find(
    (item) => text(item.id) === text(asset.projectId),
  );
  const siteId = text(asset.siteId) || text(project?.siteId);
  const provinceId = text(asset.provinceId) || text(project?.provinceId);
  const site = sites.find((item) => text(item.id) === siteId);
  const province = provinces.find((item) => text(item.id) === provinceId);
  const supplier = suppliers.find(
    (item) => text(item.id) === text(asset.supplierId),
  );
  const responsible = employees.find(
    (employee) =>
      text(employee.member?.memberId) === text(asset.assignedMemberId),
  );
  const heading = text(asset.name) || text(asset.assetNumber) || "—";
  const statusLabels: Record<string, [string, string]> = {
    available: ["Available", "Disponible"],
    assigned: ["Assigned", "Affecté"],
    in_use: ["In use", "En service"],
    under_maintenance: ["Under maintenance", "En maintenance"],
    out_of_service: ["Out of service", "Hors service"],
    damaged: ["Damaged", "Endommagé"],
    retired: ["Retired", "Retiré"],
    sold: ["Sold", "Vendu"],
    lost: ["Lost", "Perdu"],
  };
  const conditionLabels: Record<string, [string, string]> = {
    new: ["New", "Neuf"],
    excellent: ["Excellent", "Excellent"],
    good: ["Good", "Bon"],
    fair: ["Fair", "Moyen"],
    poor: ["Poor", "Mauvais"],
    damaged: ["Damaged", "Endommagé"],
  };
  const localizedValue = (
    value: unknown,
    labels: Record<string, [string, string]>,
  ) => {
    const label = labels[text(value)];
    return label ? (fr ? label[1] : label[0]) : nice(value);
  };
  const currency = text(asset.currencyCode) || "—";
  const price =
    asset.purchasePrice == null || asset.purchasePrice === ""
      ? "—"
      : `${amount(asset.purchasePrice).toLocaleString(fr ? "fr-FR" : "en-US")} ${currency}`;
  const location = text(asset.currentLocation);
  const projectName = text(asset.projectName) || text(project?.name) || "—";
  const projectCode = text(asset.projectCode) || text(project?.code);
  const siteName = text(asset.siteName) || text(site?.name) || "—";
  const provinceName = text(asset.provinceName) || text(province?.name) || "—";
  const supplierName = text(asset.supplierName) || text(supplier?.name) || "—";
  const responsibleName =
    text(asset.assignedMemberName) || text(responsible?.fullName) || "—";
  const detailGroups: Array<{
    title: string;
    details: Array<[string, string]>;
  }> = [
    {
      title: copy(fr, "Equipment identity", "Identité de l’équipement"),
      details: [
        [
          copy(fr, "Asset number", "Numéro d’actif"),
          text(asset.assetNumber) || "—",
        ],
        [copy(fr, "Category", "Catégorie"), text(asset.category) || "—"],
        [
          copy(fr, "Status", "Statut"),
          localizedValue(asset.status, statusLabels),
        ],
        [
          copy(fr, "Condition", "État"),
          localizedValue(asset.condition, conditionLabels),
        ],
        [copy(fr, "Brand", "Marque"), text(asset.brand) || "—"],
        [copy(fr, "Model", "Modèle"), text(asset.model) || "—"],
        [
          copy(fr, "Serial number", "Numéro de série"),
          text(asset.serialNumber) || "—",
        ],
      ],
    },
    {
      title: copy(fr, "Location and responsibility", "Lieu et responsabilité"),
      details: [
        [
          copy(fr, "Project", "Projet"),
          projectCode ? `${projectName} · ${projectCode}` : projectName,
        ],
        [copy(fr, "Province", "Province"), provinceName],
        [copy(fr, "Site / farm", "Site / ferme"), siteName],
        [copy(fr, "Current location", "Emplacement actuel"), location || "—"],
        [copy(fr, "Responsible person", "Responsable"), responsibleName],
      ],
    },
    {
      title: copy(fr, "Purchase traceability", "Traçabilité de l’achat"),
      details: [
        [copy(fr, "Supplier", "Fournisseur"), supplierName],
        [copy(fr, "Purchase date", "Date d’achat"), date(asset.purchaseDate)],
        [copy(fr, "Purchase cost", "Coût d’achat"), price],
      ],
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[80] overflow-y-auto bg-ink/55 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`equipment-detail-${asset.id}`}
      onMouseDown={onClose}
    >
      <section
        className="mx-auto my-5 w-full max-w-6xl overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-surface-2 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[.13em] text-brand">
              {copy(fr, "Equipment record", "Fiche équipement")}
            </p>
            <h2
              id={`equipment-detail-${asset.id}`}
              className="mt-1 truncate text-xl font-semibold text-ink sm:text-2xl"
            >
              {heading}
            </h2>
            <p className="mt-1 text-sm text-ink-secondary">
              {text(asset.assetNumber) ||
                copy(fr, "Company equipment", "Équipement de l’entreprise")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {onEdit ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={onEdit}
              >
                <Settings2 />
                {copy(fr, "Edit", "Modifier")}
              </Button>
            ) : null}
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={onClose}
              aria-label={copy(fr, "Close", "Fermer")}
            >
              <X />
            </Button>
          </div>
        </header>
        <div className="max-h-[78vh] overflow-y-auto p-5 sm:p-6">
          <div className="grid gap-5 lg:grid-cols-[minmax(15rem,22rem)_1fr]">
            <section className="overflow-hidden rounded-2xl border border-border bg-surface-2">
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt={text(photo?.altText) || heading}
                  className="aspect-[4/3] w-full bg-surface-3 object-cover"
                />
              ) : (
                <div className="grid aspect-[4/3] place-items-center bg-brand/[0.045] text-center text-brand">
                  <div>
                    <ImageIcon className="mx-auto size-9" />
                    <p className="mt-2 text-sm font-semibold">
                      {copy(
                        fr,
                        "No equipment photo",
                        "Aucune photo d’équipement",
                      )}
                    </p>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2 p-4">
                <Badge variant={tone(asset.status)}>
                  {localizedValue(asset.status, statusLabels)}
                </Badge>
                <Badge variant="neutral">{text(asset.category) || "—"}</Badge>
              </div>
            </section>
            <div className="space-y-5">
              {detailGroups.map((group) => (
                <section
                  key={group.title}
                  className="rounded-2xl border border-border bg-surface-1 p-4"
                >
                  <h3 className="text-sm font-semibold text-ink">
                    {group.title}
                  </h3>
                  <dl className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {group.details.map(([label, value]) => (
                      <div
                        key={label}
                        className="min-w-0 rounded-xl bg-surface-2 px-3 py-2.5"
                      >
                        <dt className="text-xs font-medium text-ink-muted">
                          {label}
                        </dt>
                        <dd className="mt-1 break-words text-sm font-semibold text-ink">
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          </div>
          {text(asset.notes) ? (
            <section className="mt-5 rounded-2xl border border-border bg-surface-2 p-4">
              <h3 className="text-sm font-semibold text-ink">
                {copy(fr, "Notes", "Notes")}
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-secondary">
                {text(asset.notes)}
              </p>
            </section>
          ) : null}
        </div>
      </section>
    </div>
  );
}
function SidebarTaskDetailDialog({
  orgSlug,
  task,
  fr,
  onClose,
  onEdit,
  canUploadEvidence,
  onPreview,
}: {
  orgSlug: string;
  task: Row;
  fr: boolean;
  onClose: () => void;
  onEdit?: () => void;
  canUploadEvidence: boolean;
  onPreview: (document: Row) => void;
}) {
  const client = useQueryClient();
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const documents = useQuery({
    queryKey: ["operations", orgSlug, "task-documents", task.id],
    queryFn: () =>
      ownerManagementApi.taskDocuments<{ documents: Row[] }>(orgSlug, task.id),
    select: (data) => data.documents,
    enabled: Boolean(task.projectId),
  });
  const evidenceUpload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.set("file", file);
      const taskTitle = text(task.title) || copy(fr, "Task", "Tâche");
      form.set("title", `${taskTitle.slice(0, 170)} · evidence`);
      await api.post(orgApiUrl(orgSlug, `task-evidence/${task.id}`), form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
    },
    onSuccess: async () => {
      setEvidenceError(null);
      await client.invalidateQueries({
        queryKey: ["operations", orgSlug, "task-documents", task.id],
      });
    },
    onError: (error: unknown) => {
      setEvidenceError(
        error instanceof ApiError
          ? error.message
          : copy(
              fr,
              "The document could not be uploaded. Try again.",
              "Le document n’a pas pu être téléversé. Réessayez.",
            ),
      );
    },
  });
  const value = (...keys: string[]) =>
    keys
      .map((key) => task[key])
      .find((item) => item != null && String(item).trim()) ?? null;
  const money = (amountValue: unknown) => {
    if (amountValue == null || amountValue === "") return "—";
    const currency = text(task.currencyCode || task.budgetCurrencyCode);
    return `${amount(amountValue).toLocaleString(fr ? "fr-FR" : "en-US")} ${currency}`.trim();
  };
  const details: Array<[string, string]> = [
    [
      copy(fr, "Project", "Projet"),
      text(value("projectName", "projectCode")) ||
        copy(fr, "Company task", "Tâche d’entreprise"),
    ],
    [
      copy(fr, "Project phase", "Phase du projet"),
      text(value("phaseName", "projectPhaseName")) || "—",
    ],
    [
      copy(fr, "Assigned employee", "Employé affecté"),
      text(
        value("assignedEmployeeName", "assignedMemberName", "assigneeName"),
      ) || "—",
    ],
    [copy(fr, "Start date", "Date de début"), date(value("startDate"))],
    [copy(fr, "Due date", "Échéance"), date(value("dueDate"))],
    [copy(fr, "Estimated cost", "Coût estimé"), money(value("estimatedCost"))],
    [copy(fr, "Actual cost", "Coût réel"), money(value("actualCost"))],
  ];
  return (
    <div
      className="fixed inset-0 z-[80] overflow-y-auto bg-ink/55 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sidebar-task-detail-title"
    >
      <section className="mx-auto my-6 w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-2xl">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-surface-2 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[.13em] text-brand">
              {copy(fr, "Project task", "Tâche du projet")}
            </p>
            <h2
              id="sidebar-task-detail-title"
              className="mt-1 truncate text-xl font-semibold text-ink"
            >
              {text(task.title) ||
                copy(fr, "Untitled task", "Tâche sans titre")}
            </h2>
            <p className="mt-1 text-xs text-ink-secondary">
              {text(task.code) || "—"} · {nice(task.taskType || "work")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {onEdit ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={onEdit}
              >
                <Settings2 />
                {copy(fr, "Edit", "Modifier")}
              </Button>
            ) : null}
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={onClose}
              aria-label={copy(fr, "Close", "Fermer")}
            >
              <X />
            </Button>
          </div>
        </header>
        <div className="max-h-[78vh] overflow-y-auto p-5">
          <div className="flex flex-wrap gap-2">
            <Badge variant={tone(task.status)}>{nice(task.status)}</Badge>
            <Badge variant={tone(task.priority)}>{nice(task.priority)}</Badge>
            <Badge variant="neutral">
              {Math.round(amount(task.progressPercent))}%
            </Badge>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {details.map(([label, detail]) => (
              <div
                key={label}
                className="rounded-xl border border-border bg-surface-2 p-3"
              >
                <p className="text-xs font-medium text-ink-muted">{label}</p>
                <p className="mt-1 truncate text-sm font-semibold text-ink">
                  {detail || "—"}
                </p>
              </div>
            ))}
          </div>
          {text(task.blockedReason) ? (
            <section className="mt-5 rounded-xl border border-warning/35 bg-warning/10 p-4">
              <h3 className="text-sm font-semibold text-ink">
                {copy(fr, "Blocked by / reason", "Blocage / raison")}
              </h3>
              <p className="mt-1 text-sm text-ink-secondary">
                {text(task.blockedReason)}
              </p>
            </section>
          ) : null}
          {text(task.description) || text(task.notes) ? (
            <section className="mt-5 rounded-xl border border-border bg-surface-2 p-4">
              <h3 className="text-sm font-semibold text-ink">
                {copy(fr, "Description and notes", "Description et notes")}
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-secondary">
                {text(task.description) || text(task.notes)}
              </p>
            </section>
          ) : null}
          <section className="mt-5 rounded-xl border border-border bg-surface-2 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink">
                  {copy(fr, "Attached documents", "Documents joints")}
                </h3>
                <p className="mt-1 text-xs text-ink-secondary">
                  {copy(
                    fr,
                    "Open a file to preview it without leaving this task.",
                    "Ouvrez un fichier pour le prévisualiser sans quitter cette tâche.",
                  )}
                </p>
              </div>
              <FileText className="size-5 text-brand" />
            </div>
            {task.projectId && canUploadEvidence ? (
              <div className="mt-4 rounded-lg border border-dashed border-brand/35 bg-brand/5 p-3">
                <label
                  htmlFor={`task-evidence-${task.id}`}
                  className="block text-sm font-semibold text-ink"
                >
                  {copy(fr, "Add a document", "Ajouter un document")}
                </label>
                <p className="mt-1 text-xs leading-5 text-ink-secondary">
                  {copy(
                    fr,
                    "PDF or image. It is saved in the project documents and linked to this task only once.",
                    "PDF ou image. Il est enregistré dans les Documents du projet et lié une seule fois à cette tâche.",
                  )}
                </p>
                <Input
                  id={`task-evidence-${task.id}`}
                  className="mt-3"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
                  disabled={evidenceUpload.isPending}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) evidenceUpload.mutate(file);
                    event.target.value = "";
                  }}
                />
                {evidenceUpload.isPending ? (
                  <p className="mt-2 text-xs text-ink-secondary">
                    {copy(
                      fr,
                      "Uploading document…",
                      "Téléversement du document…",
                    )}
                  </p>
                ) : null}
                {evidenceError ? (
                  <p
                    role="alert"
                    className="mt-2 text-xs font-medium text-critical"
                  >
                    {evidenceError}
                  </p>
                ) : null}
              </div>
            ) : null}
            {!task.projectId ? (
              <p className="mt-4 rounded-lg border border-dashed border-border p-3 text-sm text-ink-secondary">
                {copy(
                  fr,
                  "This normal company task has no project documents.",
                  "Cette tâche normale n’a pas de documents de projet.",
                )}
              </p>
            ) : documents.isPending ? (
              <Skeleton className="mt-4 h-16" />
            ) : documents.data?.length ? (
              <div className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface-1">
                {documents.data.map((document) => (
                  <button
                    key={document.id}
                    type="button"
                    onClick={() => onPreview(document)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-surface-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">
                        {text(document.title) || "—"}
                      </span>
                      <span className="mt-1 block truncate text-xs text-ink-secondary">
                        {text(
                          document.documentCategoryName ||
                            document.documentType,
                        ) || "—"}{" "}
                        · {text(document.mimeType) || "—"}
                      </span>
                    </span>
                    <ArrowUpRight className="size-4 shrink-0 text-brand" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-lg border border-dashed border-border p-3 text-sm text-ink-secondary">
                {copy(
                  fr,
                  "No document is linked to this task.",
                  "Aucun document n’est lié à cette tâche.",
                )}
              </p>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

function TaskDocumentPreviewDialog({
  orgSlug,
  document,
  fr,
  onClose,
}: {
  orgSlug: string;
  document: Row;
  fr: boolean;
  onClose: () => void;
}) {
  const previewUrl = orgApiUrl(orgSlug, `files/${document.id}/preview`);
  const downloadUrl = orgApiUrl(orgSlug, `files/${document.id}/download`);
  const mimeType = text(document.mimeType);
  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-ink/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-document-preview-title"
    >
      <section className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-border bg-surface-2 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[.13em] text-brand">
              {copy(fr, "Task document", "Document de tâche")}
            </p>
            <h2
              id="task-document-preview-title"
              className="mt-1 truncate text-lg font-semibold text-ink"
            >
              {text(document.title) || "—"}
            </h2>
          </div>
          <div className="flex gap-2">
            <a
              href={downloadUrl}
              className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-semibold text-brand hover:bg-surface-3"
            >
              {copy(fr, "Download", "Télécharger")}
            </a>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={onClose}
              aria-label={copy(fr, "Close", "Fermer")}
            >
              <X />
            </Button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto bg-surface-3 p-4">
          {mimeType.startsWith("image/") ? (
            <img
              src={previewUrl}
              alt={text(document.title)}
              className="mx-auto max-h-[72vh] max-w-full rounded-lg bg-white object-contain shadow"
            />
          ) : mimeType === "application/pdf" ? (
            <iframe
              title={text(document.title)}
              src={previewUrl}
              className="h-[72vh] w-full rounded-lg border border-border bg-white"
            />
          ) : (
            <a
              href={downloadUrl}
              className="mx-auto flex max-w-md flex-col items-center rounded-xl border border-dashed border-border bg-surface-1 p-8 text-center text-sm text-ink-secondary"
            >
              <Download className="size-8 text-brand" />
              {copy(
                fr,
                "Preview is unavailable for this file type. Download the file to open it.",
                "L’aperçu n’est pas disponible pour ce type de fichier. Téléchargez-le pour l’ouvrir.",
              )}
            </a>
          )}
        </div>
      </section>
    </div>
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
  const [selectedTask, setSelectedTask] = useState<Row | null>(null);
  const [previewDocument, setPreviewDocument] = useState<Row | null>(null);
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
  const taskProjectOptions = selectOptions(projects.data ?? [], [
    "name",
    "code",
  ]);
  const selectedProjectId =
    projectFilter !== "all" && projectFilter !== "company"
      ? projectFilter
      : null;
  const newTaskDefaults: ManagementBody | undefined = selectedProjectId
    ? { projectId: selectedProjectId, taskType: "work", status: "not_started" }
    : undefined;
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
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <select
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
              aria-label={copy(
                fr,
                "Filter tasks by project",
                "Filtrer les tâches par projet",
              )}
              className="h-10 min-w-0 rounded-lg border border-white/30 bg-white px-3 text-sm font-medium text-ink shadow-sm outline-none transition focus:border-white focus:ring-2 focus:ring-white/50 sm:w-64"
            >
              <option value="all">
                {copy(fr, "All projects", "Tous les projets")}
              </option>
              <option value="company">
                {copy(
                  fr,
                  "Company tasks only",
                  "Tâches d’entreprise seulement",
                )}
              </option>
              {taskProjectOptions.map((project) => (
                <option key={project.value} value={project.value}>
                  {project.label}
                </option>
              ))}
            </select>
            {can(user, "tasks.create") ? (
              <Button onClick={() => setEditor("new")}>
                <Plus />
                {copy(fr, "Create task", "Créer une tâche")}
              </Button>
            ) : null}
          </div>
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
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedTask(task)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedTask(task);
                        }
                      }}
                      className="group relative cursor-pointer overflow-hidden rounded-xl border border-border bg-surface-1 p-4 transition hover:-translate-y-0.5 hover:border-brand/35 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    >
                      <span
                        className={`absolute inset-y-0 left-0 w-1 ${priorityClass(task.priority)}`}
                      />
                      <div className="pl-2">
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            className="min-w-0 text-left"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedTask(task);
                            }}
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
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setDocumentsTaskId(
                                    openDocuments ? null : task.id,
                                  );
                                }}
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
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedTask(task);
                              }}
                            >
                              {copy(fr, "Open", "Ouvrir")}
                            </Button>
                            {text(task.status) !== "completed" &&
                            can(user, "tasks.update") ? (
                              <Button
                                size="sm"
                                loading={complete.isPending}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  complete.mutate(task);
                                }}
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
                      onClick={() => setSelectedTask(task)}
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
      {selectedTask ? (
        <SidebarTaskDetailDialog
          orgSlug={orgSlug}
          task={selectedTask}
          fr={fr}
          onClose={() => setSelectedTask(null)}
          canUploadEvidence={can(user, "tasks.update")}
          onEdit={
            can(user, "tasks.update")
              ? () => {
                  setEditor(selectedTask);
                  setSelectedTask(null);
                }
              : undefined
          }
          onPreview={setPreviewDocument}
        />
      ) : null}
      {previewDocument ? (
        <TaskDocumentPreviewDialog
          orgSlug={orgSlug}
          document={previewDocument}
          fr={fr}
          onClose={() => setPreviewDocument(null)}
        />
      ) : null}
      {editor ? (
        <Editor
          title={
            editor === "new"
              ? copy(fr, "Create task", "Créer une tâche")
              : copy(fr, "Edit task", "Modifier la tâche")
          }
          subtitle={copy(fr, "Shared Operations", "Opérations partagées")}
          row={editor === "new" ? undefined : editor}
          defaults={editor === "new" ? newTaskDefaults : undefined}
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
  const projects = useRows(orgSlug, "projects", can(user, "projects.read"));
  const refs = useReferences(
    orgSlug,
    can(user, "sites.read") || can(user, "employees.read"),
  );
  const [inventorySearch, setInventorySearch] = useState("");
  const [inventoryProjectFilter, setInventoryProjectFilter] = useState("all");
  const [inventoryProvinceFilter, setInventoryProvinceFilter] = useState("all");
  const [inventorySiteFilter, setInventorySiteFilter] = useState("all");
  const [inventoryWarehouseFilter, setInventoryWarehouseFilter] =
    useState("all");
  const [inventoryCategoryFilter, setInventoryCategoryFilter] = useState("all");
  const [inventoryLowStock, setInventoryLowStock] = useState(false);
  const [stockPage, setStockPage] = useState(0);
  const [movementDefaults, setMovementDefaults] =
    useState<ManagementBody | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [movementHistoryDate, setMovementHistoryDate] = useState(today());
  const [inventoryCreateTarget, setInventoryCreateTarget] = useState<
    "item" | "warehouse" | null
  >(null);
  const [inventoryCreateVersion, setInventoryCreateVersion] = useState(0);
  const canRecordStockMovement = can(user, "inventory.movements.create");
  const canCreateInventoryItem = can(user, "inventory.items.create");
  const canCreateWarehouse = can(user, "inventory.warehouses.create");
  const openInventoryCreate = (target: "item" | "warehouse") => {
    setInventoryCreateTarget(target);
    setInventoryCreateVersion((value) => value + 1);
  };
  const projectById = new Map(
    (projects.data ?? []).map((project) => [text(project.id), project]),
  );
  const siteById = new Map(
    (refs.sites.data ?? []).map((site) => [text(site.id), site]),
  );
  const warehouseById = new Map(
    (warehouses.data ?? []).map((warehouse) => [text(warehouse.id), warehouse]),
  );
  const transferWarehouseOptions = (warehouses.data ?? []).map((warehouse) => {
    const site = siteById.get(text(warehouse.siteId));
    const province = (refs.provinces.data ?? []).find(
      (candidate) => text(candidate.id) === text(site?.provinceId),
    );
    return {
      value: text(warehouse.id),
      label: [text(warehouse.name), text(site?.name), text(province?.name)]
        .filter(Boolean)
        .join(" · "),
    };
  });
  const itemById = new Map(
    (items.data ?? []).map((item) => [text(item.id), item]),
  );
  const selectedInventoryProject =
    inventoryProjectFilter === "all"
      ? null
      : (projectById.get(inventoryProjectFilter) ?? null);
  const projectProvinceId = text(selectedInventoryProject?.provinceId);
  const projectSiteId = text(selectedInventoryProject?.siteId);
  const effectiveInventoryProvinceId =
    inventoryProvinceFilter !== "all"
      ? inventoryProvinceFilter
      : projectProvinceId || undefined;
  const effectiveInventorySiteId =
    inventorySiteFilter !== "all"
      ? inventorySiteFilter
      : projectSiteId || undefined;
  const balances = useQuery({
    queryKey: [
      "operations",
      orgSlug,
      "inventory-stock",
      effectiveInventoryProvinceId ?? "all",
      effectiveInventorySiteId ?? "all",
      inventoryWarehouseFilter,
      inventoryLowStock,
    ],
    queryFn: () =>
      ownerManagementApi.stockBalances<RecordsResponse>(orgSlug, {
        provinceId: effectiveInventoryProvinceId,
        siteId: effectiveInventorySiteId,
        warehouseId:
          inventoryWarehouseFilter === "all"
            ? undefined
            : inventoryWarehouseFilter,
        lowStock: inventoryLowStock || undefined,
      }),
    select: (data) => data.records,
    enabled: can(user, "inventory.stock.read"),
  });
  const inventoryQuery = inventorySearch.trim().toLocaleLowerCase();
  const matchesInventoryQuery = (...values: unknown[]) =>
    !inventoryQuery ||
    values
      .map((value) => text(value).toLocaleLowerCase())
      .join(" ")
      .includes(inventoryQuery);
  const inventoryCategoryOptions = Array.from(
    new Map(
      [
        ...feedInventoryCategoryOptions(fr),
        ...(items.data ?? []).map((item) => ({
          value: text(item.category),
          label: inventoryCategoryName(item.category, fr),
        })),
      ]
        .filter((category) => category.value)
        .map((category) => [category.value.toLocaleLowerCase(), category]),
    ).values(),
  ).sort((left, right) => left.label.localeCompare(right.label));
  const filteredBalances = (balances.data ?? []).filter(
    (balance) =>
      (inventoryCategoryFilter === "all" ||
        text(balance.itemCategory) === inventoryCategoryFilter) &&
      matchesInventoryQuery(
        balance.itemName,
        balance.itemCode,
        balance.itemCategory,
        balance.warehouseName,
        balance.warehouseCode,
        balance.siteName,
        balance.provinceName,
      ),
  );
  const stockGridColumns = canRecordStockMovement
    ? "md:grid-cols-[minmax(0,1.7fr)_minmax(0,1.3fr)_minmax(7rem,.85fr)_minmax(6rem,.75fr)_minmax(6rem,.75fr)_minmax(6.5rem,.75fr)]"
    : "md:grid-cols-[minmax(0,1.7fr)_minmax(0,1.3fr)_minmax(7rem,.85fr)_minmax(6rem,.75fr)_minmax(6rem,.75fr)]";
  const stockPageSize = 8;
  const stockPageCount = Math.max(
    1,
    Math.ceil(filteredBalances.length / stockPageSize),
  );
  const safeStockPage = Math.min(stockPage, stockPageCount - 1);
  const visibleBalances = filteredBalances.slice(
    safeStockPage * stockPageSize,
    (safeStockPage + 1) * stockPageSize,
  );
  const stockStart = filteredBalances.length
    ? safeStockPage * stockPageSize + 1
    : 0;
  const stockEnd = Math.min(
    (safeStockPage + 1) * stockPageSize,
    filteredBalances.length,
  );
  const filteredItems = (items.data ?? []).filter(
    (item) =>
      (inventoryCategoryFilter === "all" ||
        text(item.category) === inventoryCategoryFilter) &&
      matchesInventoryQuery(item.name, item.code, item.category, item.unit),
  );
  const filteredWarehouses = (warehouses.data ?? []).filter((warehouse) => {
    const site = siteById.get(text(warehouse.siteId));
    const warehouseSiteId = text(warehouse.siteId);
    const warehouseProvinceId = text(site?.provinceId);
    return (
      (effectiveInventoryProvinceId === undefined ||
        warehouseProvinceId === effectiveInventoryProvinceId) &&
      (effectiveInventorySiteId === undefined ||
        warehouseSiteId === effectiveInventorySiteId) &&
      (inventoryWarehouseFilter === "all" ||
        text(warehouse.id) === inventoryWarehouseFilter) &&
      matchesInventoryQuery(
        warehouse.name,
        warehouse.code,
        warehouse.notes,
        site?.name,
      )
    );
  });
  const filteredMovements = (movements.data ?? []).filter((stockMovement) => {
    const warehouse = warehouseById.get(text(stockMovement.warehouseId));
    const site = siteById.get(text(warehouse?.siteId));
    const item = itemById.get(text(stockMovement.itemId));
    const movementSiteId = text(warehouse?.siteId);
    const movementProvinceId = text(site?.provinceId);
    return (
      (inventoryProjectFilter === "all" ||
        text(stockMovement.projectId) === inventoryProjectFilter) &&
      (effectiveInventoryProvinceId === undefined ||
        movementProvinceId === effectiveInventoryProvinceId) &&
      (effectiveInventorySiteId === undefined ||
        movementSiteId === effectiveInventorySiteId) &&
      (inventoryWarehouseFilter === "all" ||
        text(stockMovement.warehouseId) === inventoryWarehouseFilter) &&
      (inventoryCategoryFilter === "all" ||
        text(item?.category) === inventoryCategoryFilter) &&
      matchesInventoryQuery(
        stockMovement.movementType,
        stockMovement.notes,
        item?.name,
        item?.code,
        warehouse?.name,
        warehouse?.code,
        site?.name,
      )
    );
  });
  const movementHistoryPdfParams = new URLSearchParams({
    date: movementHistoryDate,
  });
  if (inventoryWarehouseFilter !== "all")
    movementHistoryPdfParams.set("warehouseId", inventoryWarehouseFilter);
  if (effectiveInventoryProvinceId)
    movementHistoryPdfParams.set("provinceId", effectiveInventoryProvinceId);
  if (effectiveInventorySiteId)
    movementHistoryPdfParams.set("siteId", effectiveInventorySiteId);
  const movementHistoryPdfUrl = orgApiUrl(
    orgSlug,
    `owner-management/inventory-stock/movements/export.pdf?${movementHistoryPdfParams.toString()}`,
  );
  const hasInventoryFilters = Boolean(
    inventorySearch ||
    inventoryProjectFilter !== "all" ||
    inventoryProvinceFilter !== "all" ||
    inventorySiteFilter !== "all" ||
    inventoryWarehouseFilter !== "all" ||
    inventoryCategoryFilter !== "all" ||
    inventoryLowStock,
  );
  const recordMovement = useMutation({
    mutationFn: (body: ManagementBody) =>
      ownerManagementApi.create(orgSlug, "stock-movements", body),
    onSuccess: () => {
      setMovementDefaults(null);
      void client.invalidateQueries({ queryKey: ["operations", orgSlug] });
    },
  });
  const transferStock = useMutation({
    mutationFn: (body: ManagementBody) =>
      ownerManagementApi.transferInventoryStock(orgSlug, {
        sourceWarehouseId: text(body.sourceWarehouseId),
        destinationWarehouseId: text(body.destinationWarehouseId),
        itemId: text(body.itemId),
        quantity: amount(body.quantity),
        movementDate: text(body.movementDate),
        notes: text(body.notes) || undefined,
      }),
    onSuccess: () => {
      setTransferOpen(false);
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
    {
      key: "category",
      label: copy(fr, "Category", "Catégorie"),
      type: "combobox",
      options: inventoryCategoryOptions,
      hint: copy(
        fr,
        "Choose a Feed mill category only for ingredients or finished feed. Other stock stays outside recipes.",
        "Choisissez une catégorie Provenderie uniquement pour un ingrédient ou un aliment fabriqué. Les autres stocks restent hors des recettes.",
      ),
    },
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
      hint: copy(
        fr,
        "Leave blank to generate a secure unique code. You may also enter your own short code.",
        "Laissez vide pour générer un code unique. Vous pouvez aussi saisir votre propre code court.",
      ),
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
      label: copy(fr, "Movement", "Mouvement"),
      type: "select",
      required: true,
      defaultValue: "receipt",
      hint: copy(
        fr,
        "Choose the action that actually happened. Use an adjustment only to correct a stock count.",
        "Choisissez l’action réellement effectuée. Utilisez un ajustement uniquement pour corriger un comptage.",
      ),
      options: [
        "receipt",
        "issue",
        "return",
        "adjustment_in",
        "adjustment_out",
      ].map((value) => ({ value, label: inventoryMovementLabel(value, fr) })),
    },
    {
      key: "quantityDelta",
      label: copy(fr, "Quantity", "Quantité"),
      type: "number",
      required: true,
      step: "0.001",
      hint: copy(
        fr,
        "Enter a positive quantity. The movement type applies the direction automatically.",
        "Saisissez une quantité positive. Le type de mouvement applique le sens automatiquement.",
      ),
    },
    {
      key: "movementDate",
      label: copy(fr, "Movement date", "Date du mouvement"),
      type: "date",
      defaultValue: today(),
    },
    { key: "notes", label: copy(fr, "Notes", "Notes"), type: "textarea" },
  ];
  const transferFields: FormField[] = [
    {
      key: "sourceWarehouseId",
      label: copy(fr, "From warehouse", "Magasin de départ"),
      type: "select",
      required: true,
      options: transferWarehouseOptions,
      emptyLabel: copy(
        fr,
        "No warehouse available",
        "Aucun entrepôt disponible",
      ),
    },
    {
      key: "destinationWarehouseId",
      label: copy(fr, "To warehouse", "Magasin d’arrivée"),
      type: "select",
      required: true,
      options: transferWarehouseOptions,
      emptyLabel: copy(
        fr,
        "No warehouse available",
        "Aucun entrepôt disponible",
      ),
      hint: copy(
        fr,
        "Choose a different warehouse. It may be at another site or in another province you are allowed to manage.",
        "Choisissez un autre entrepôt. Il peut être sur un autre site ou dans une autre province que vous êtes autorisé à gérer.",
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
        "No inventory item available",
        "Aucun article disponible",
      ),
    },
    {
      key: "quantity",
      label: copy(fr, "Quantity to transfer", "Quantité à transférer"),
      type: "number",
      required: true,
      step: "0.001",
      hint: copy(
        fr,
        "The quantity is removed from the departure warehouse and added to the arrival warehouse at the same time.",
        "La quantité est retirée du magasin de départ et ajoutée au magasin d’arrivée au même moment.",
      ),
    },
    {
      key: "movementDate",
      label: copy(fr, "Transfer date", "Date du transfert"),
      type: "date",
      required: true,
      defaultValue: today(),
    },
    {
      key: "notes",
      label: copy(fr, "Reason / notes", "Motif / notes"),
      type: "textarea",
    },
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
          <div className="flex flex-wrap gap-2">
            {canRecordStockMovement ? (
              <a
                href={orgApiUrl(
                  orgSlug,
                  "owner-management/inventory/stock-issue-form.pdf",
                )}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-ink bg-ink px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-ink/90"
              >
                <Download className="size-3.5" />
                {copy(fr, "Issue PDF", "Formulaire sortie")}
              </a>
            ) : null}
            {canRecordStockMovement ? (
              <a
                href={orgApiUrl(
                  orgSlug,
                  "owner-management/inventory/stock-transfer-form.pdf",
                )}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-brand bg-brand px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-brand/90"
              >
                <Download className="size-3.5" />
                {copy(fr, "Transfer PDF", "Formulaire transfert")}
              </a>
            ) : null}
            {canRecordStockMovement ? (
              <Button variant="secondary" onClick={() => setTransferOpen(true)}>
                <ArrowRightLeft />
                {copy(fr, "Transfer stock", "Transférer")}
              </Button>
            ) : null}
            {canRecordStockMovement ? (
              <Button onClick={() => setMovementDefaults({})}>
                <Plus />
                {copy(fr, "Record movement", "Enregistrer un mouvement")}
              </Button>
            ) : null}
            {canCreateInventoryItem ? (
              <Button
                variant="secondary"
                onClick={() => openInventoryCreate("item")}
              >
                <Plus />
                {copy(fr, "Add item", "Ajouter un article")}
              </Button>
            ) : null}
            {canCreateWarehouse ? (
              <Button
                variant="secondary"
                onClick={() => openInventoryCreate("warehouse")}
              >
                <Plus />
                {copy(fr, "Add warehouse", "Ajouter un entrepôt")}
              </Button>
            ) : null}
          </div>
        }
      />
      <section className="rounded-2xl border border-brand/20 bg-surface-1 p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-brand">
              {copy(fr, "Inventory scope", "Périmètre de l’inventaire")}
            </p>
            <h2 className="mt-1 text-base font-semibold text-ink">
              {copy(
                fr,
                "Find stock by location, project, or category",
                "Retrouvez le stock par lieu, projet ou catégorie",
              )}
            </h2>
            <p className="mt-1 text-sm text-ink-secondary">
              {hasInventoryFilters
                ? copy(
                    fr,
                    `${filteredBalances.length} matching stock balance(s)`,
                    `${filteredBalances.length} solde(s) de stock correspondant(s)`,
                  )
                : copy(
                    fr,
                    `${filteredBalances.length} stock balance(s)`,
                    `${filteredBalances.length} solde(s) de stock`,
                  )}
            </p>
          </div>
          {hasInventoryFilters ? (
            <button
              type="button"
              onClick={() => {
                setInventorySearch("");
                setInventoryProjectFilter("all");
                setInventoryProvinceFilter("all");
                setInventorySiteFilter("all");
                setInventoryWarehouseFilter("all");
                setInventoryCategoryFilter("all");
                setInventoryLowStock(false);
              }}
              className="text-xs font-semibold text-brand hover:underline"
            >
              {copy(fr, "Clear filters", "Effacer les filtres")}
            </button>
          ) : null}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Input
            value={inventorySearch}
            onChange={(event) => setInventorySearch(event.target.value)}
            placeholder={copy(fr, "Search stock…", "Rechercher dans le stock…")}
            aria-label={copy(
              fr,
              "Search inventory",
              "Rechercher dans l’inventaire",
            )}
          />
          <select
            value={inventoryProjectFilter}
            onChange={(event) => setInventoryProjectFilter(event.target.value)}
            className="h-9 rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
            aria-label={copy(fr, "Filter by project", "Filtrer par projet")}
          >
            <option value="all">
              {copy(fr, "All projects", "Tous les projets")}
            </option>
            {selectOptions(projects.data ?? [], ["name", "code"]).map(
              (project) => (
                <option key={project.value} value={project.value}>
                  {project.label}
                </option>
              ),
            )}
          </select>
          <select
            value={inventoryProvinceFilter}
            onChange={(event) => setInventoryProvinceFilter(event.target.value)}
            className="h-9 rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
            aria-label={copy(fr, "Filter by province", "Filtrer par province")}
          >
            <option value="all">
              {copy(fr, "All provinces", "Toutes les provinces")}
            </option>
            {selectOptions(refs.provinces.data ?? [], ["name", "code"]).map(
              (province) => (
                <option key={province.value} value={province.value}>
                  {province.label}
                </option>
              ),
            )}
          </select>
          <select
            value={inventorySiteFilter}
            onChange={(event) => setInventorySiteFilter(event.target.value)}
            className="h-9 rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
            aria-label={copy(fr, "Filter by site", "Filtrer par site")}
          >
            <option value="all">
              {copy(fr, "All sites", "Tous les sites")}
            </option>
            {selectOptions(refs.sites.data ?? [], ["name", "code"]).map(
              (site) => (
                <option key={site.value} value={site.value}>
                  {site.label}
                </option>
              ),
            )}
          </select>
          <select
            value={inventoryWarehouseFilter}
            onChange={(event) =>
              setInventoryWarehouseFilter(event.target.value)
            }
            className="h-9 rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
            aria-label={copy(fr, "Filter by warehouse", "Filtrer par entrepôt")}
          >
            <option value="all">
              {copy(fr, "All storage", "Tous les entrepôts")}
            </option>
            {selectOptions(warehouses.data ?? [], ["name", "code"]).map(
              (warehouse) => (
                <option key={warehouse.value} value={warehouse.value}>
                  {warehouse.label}
                </option>
              ),
            )}
          </select>
          <select
            value={inventoryCategoryFilter}
            onChange={(event) => setInventoryCategoryFilter(event.target.value)}
            className="h-9 rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
            aria-label={copy(fr, "Filter by category", "Filtrer par catégorie")}
          >
            <option value="all">
              {copy(fr, "All categories", "Toutes les catégories")}
            </option>
            {inventoryCategoryOptions.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
          <label className="flex h-9 items-center gap-2 rounded-md border border-border-strong bg-surface-1 px-3 text-xs font-medium text-ink-secondary">
            <input
              type="checkbox"
              checked={inventoryLowStock}
              onChange={(event) => setInventoryLowStock(event.target.checked)}
              className="size-4 rounded border-border-strong text-brand focus:ring-brand"
            />
            {copy(fr, "Low stock only", "Stock faible uniquement")}
          </label>
        </div>
        {inventoryProjectFilter !== "all" ? (
          <p className="mt-3 text-xs leading-5 text-ink-muted">
            {copy(
              fr,
              "The project limits physical stock to its site; movement history shows only movements linked to that project.",
              "Le projet limite le stock physique à son site ; l’historique affiche uniquement les mouvements liés à ce projet.",
            )}
          </p>
        ) : null}
      </section>
      <div className="grid gap-4 md:grid-cols-3">
        <Metric
          label={copy(fr, "Stock balances", "Soldes de stock")}
          value={String(filteredBalances.length)}
        />
        <Metric
          label={copy(fr, "Inventory items", "Articles de stock")}
          value={String(filteredItems.length)}
        />
        <Metric
          label={copy(fr, "Storage locations", "Emplacements de stockage")}
          value={String(filteredWarehouses.length)}
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
          {filteredBalances.length ? (
            <div className="overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-[0_14px_32px_-28px_rgb(15_23_42_/_0.75)]">
              <div
                className={`hidden ${stockGridColumns} gap-4 border-b border-border bg-surface-2/70 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted md:grid`}
              >
                <span>{copy(fr, "Item", "Article")}</span>
                <span>{copy(fr, "Storage location", "Entrepôt et site")}</span>
                <span className="text-right">
                  {copy(fr, "Available", "Disponible")}
                </span>
                <span className="text-right">
                  {copy(fr, "On hand", "En stock")}
                </span>
                <span className="text-right">
                  {copy(fr, "Reserved", "Réservé")}
                </span>
                {canRecordStockMovement ? (
                  <span className="text-right">
                    {copy(fr, "Action", "Action")}
                  </span>
                ) : null}
              </div>
              <div className="max-h-[34rem] divide-y divide-border overflow-y-auto overscroll-contain">
                {visibleBalances.map((balance) => {
                  const available = amount(balance.quantityAvailable);
                  const onHand = amount(balance.quantityOnHand);
                  const reserved = amount(balance.quantityReserved);
                  const unit = text(balance.itemUnit);
                  const availableTone =
                    available <= 0
                      ? "border-critical/20 bg-critical/10 text-critical"
                      : "border-good/20 bg-good/10 text-good-ink";
                  const reservedTone =
                    reserved > 0
                      ? "border-warning/30 bg-warning/15 text-warning-ink"
                      : "border-border bg-surface-2 text-ink-secondary";
                  return (
                    <article
                      key={balance.id}
                      className={`grid ${stockGridColumns} gap-3 px-4 py-4 transition-colors hover:bg-brand/[0.035] md:items-center md:gap-4`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">
                          {text(balance.itemName)}
                        </p>
                        <p className="mt-1 truncate text-xs text-ink-secondary">
                          {text(balance.itemCode) ||
                            text(balance.itemCategory) ||
                            copy(fr, "Inventory item", "Article de stock")}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">
                          {text(balance.warehouseName)}
                        </p>
                        <p className="mt-1 truncate text-xs text-ink-secondary">
                          {text(balance.siteName)}
                          {text(balance.provinceName)
                            ? ` · ${text(balance.provinceName)}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex items-baseline justify-between gap-3 md:block md:text-right">
                        <span className="text-xs font-medium text-ink-muted md:hidden">
                          {copy(fr, "Available", "Disponible")}
                        </span>
                        <p
                          className={`inline-flex items-baseline gap-1 rounded-lg border px-2.5 py-1 text-base font-semibold ${availableTone}`}
                        >
                          {available.toLocaleString()}{" "}
                          <span className="text-xs font-medium opacity-80">
                            {unit}
                          </span>
                        </p>
                      </div>
                      <div className="flex items-baseline justify-between gap-3 md:block md:text-right">
                        <span className="text-xs font-medium text-ink-muted md:hidden">
                          {copy(fr, "On hand", "En stock")}
                        </span>
                        <p className="inline-flex rounded-lg border border-brand/20 bg-brand/10 px-2.5 py-1 text-sm font-semibold text-brand">
                          {onHand.toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-baseline justify-between gap-3 md:block md:text-right">
                        <span className="text-xs font-medium text-ink-muted md:hidden">
                          {copy(fr, "Reserved", "Réservé")}
                        </span>
                        <p
                          className={`inline-flex rounded-lg border px-2.5 py-1 text-sm font-semibold ${reservedTone}`}
                        >
                          {reserved.toLocaleString()}
                        </p>
                      </div>
                      {canRecordStockMovement ? (
                        <div className="flex justify-end md:justify-end">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              setMovementDefaults({
                                warehouseId: text(balance.warehouseId),
                                itemId: text(balance.itemId),
                                movementDate: today(),
                              })
                            }
                          >
                            {copy(fr, "Move", "Mouvement")}
                          </Button>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
              {filteredBalances.length > stockPageSize ? (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-2/45 px-4 py-3">
                  <p className="text-xs text-ink-secondary">
                    {copy(fr, "Showing", "Affichage")} {stockStart}–{stockEnd}{" "}
                    {copy(fr, "of", "sur")} {filteredBalances.length}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={safeStockPage === 0}
                      onClick={() => setStockPage(safeStockPage - 1)}
                    >
                      {copy(fr, "Previous", "Précédent")}
                    </Button>
                    <span className="min-w-12 text-center text-xs font-semibold text-ink-secondary">
                      {safeStockPage + 1}/{stockPageCount}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={safeStockPage + 1 >= stockPageCount}
                      onClick={() => setStockPage(safeStockPage + 1)}
                    >
                      {copy(fr, "Next", "Suivant")}
                    </Button>
                  </div>
                </div>
              ) : null}
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
            rows={filteredItems}
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
            rowsVariant="cards"
            rowsClassName="max-h-[30rem]"
            createOpenSignal={
              inventoryCreateTarget === "item"
                ? inventoryCreateVersion
                : undefined
            }
            hideCreateAction
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
            rows={filteredWarehouses}
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
            rowsVariant="cards"
            rowsClassName="max-h-[30rem]"
            createOpenSignal={
              inventoryCreateTarget === "warehouse"
                ? inventoryCreateVersion
                : undefined
            }
            hideCreateAction
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
          action={
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid gap-1 text-xs font-medium text-ink-secondary">
                <span>{copy(fr, "PDF day", "Journée du PDF")}</span>
                <Input
                  type="date"
                  value={movementHistoryDate}
                  onChange={(event) =>
                    setMovementHistoryDate(event.target.value)
                  }
                  className="h-8 w-auto"
                />
              </label>
              <a
                href={movementHistoryPdfUrl}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-brand/25 bg-brand/5 px-2.5 text-xs font-semibold text-brand transition-colors hover:bg-brand/10"
              >
                <Download className="size-3.5" />
                {copy(fr, "Download PDF", "Télécharger le PDF")}
              </a>
            </div>
          }
        >
          {filteredMovements.length ? (
            <div className="max-h-[28rem] divide-y divide-border overflow-y-auto pr-1">
              {filteredMovements.map((movement) => {
                const outbound = inventoryMovementIsOutbound(
                  movement.movementType,
                );
                const item = itemById.get(text(movement.itemId));
                const warehouse = warehouseById.get(text(movement.warehouseId));
                const transferCounterpart =
                  text(movement.referenceType) === "warehouse_transfer"
                    ? (movements.data ?? []).find(
                        (candidate) =>
                          text(candidate.id) !== text(movement.id) &&
                          text(candidate.referenceId) ===
                            text(movement.referenceId),
                      )
                    : null;
                const counterpartWarehouse = transferCounterpart
                  ? warehouseById.get(text(transferCounterpart.warehouseId))
                  : null;
                const quantity = Math.abs(amount(movement.quantityDelta));
                const unit = text(item?.unit) || copy(fr, "units", "unités");
                return (
                  <article
                    key={text(movement.id)}
                    className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">
                        {inventoryMovementLabel(movement.movementType, fr)}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-ink-secondary">
                        {text(item?.name) ||
                          copy(fr, "Stock item", "Article de stock")}
                        {warehouse ? ` · ${text(warehouse.name)}` : ""}
                        {movement.movementDate
                          ? ` · ${date(movement.movementDate)}`
                          : ""}
                        {text(movement.performedByName)
                          ? ` · ${copy(fr, "by", "par")} ${text(movement.performedByName)}`
                          : ""}
                        {movement.createdAt
                          ? ` · ${dateTime(movement.createdAt, fr)}`
                          : ""}
                        {counterpartWarehouse
                          ? ` · ${outbound ? copy(fr, "to", "vers") : copy(fr, "from", "depuis")} ${text(counterpartWarehouse.name)}`
                          : ""}
                      </p>
                      {text(movement.notes) ? (
                        <p className="mt-1 text-xs text-ink-muted">
                          {text(movement.notes)}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={`shrink-0 rounded-lg px-2.5 py-1 text-sm font-bold ${
                        outbound
                          ? "bg-critical/10 text-critical"
                          : "bg-brand/10 text-brand"
                      }`}
                    >
                      {outbound ? "−" : "+"}
                      {quantity.toLocaleString(fr ? "fr-FR" : "en-US")} {unit}
                    </span>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title={copy(fr, "No stock movements", "Aucun mouvement de stock")}
            />
          )}
        </Panel>
      </QueryState>
      {movementDefaults ? (
        <Editor
          title={copy(
            fr,
            "Record stock movement",
            "Enregistrer un mouvement de stock",
          )}
          subtitle={copy(fr, "Inventory", "Inventaire")}
          fields={movementFields}
          defaults={movementDefaults}
          pending={recordMovement.isPending}
          error={recordMovement.error}
          close={() => setMovementDefaults(null)}
          save={recordMovement.mutate}
          fr={fr}
        />
      ) : null}
      {transferOpen ? (
        <Editor
          title={copy(fr, "Transfer stock", "Transférer le stock")}
          subtitle={copy(fr, "Inventory", "Inventaire")}
          fields={transferFields}
          defaults={{ movementDate: today() }}
          pending={transferStock.isPending}
          error={transferStock.error}
          close={() => setTransferOpen(false)}
          save={transferStock.mutate}
          fr={fr}
        />
      ) : null}
    </main>
  );
}
function FeedManufacturingPanel({
  orgSlug,
  fr,
  items,
  warehouses,
  projects,
  sites,
  siteFilter,
}: {
  orgSlug: string;
  fr: boolean;
  items: Row[];
  warehouses: Row[];
  projects: Row[];
  sites: Place[];
  siteFilter?: string;
}) {
  const user = useSessionUser();
  const client = useQueryClient();
  const canRead = can(user, "inventory.nutrition.read");
  const canCreate = can(user, "inventory.nutrition.create");
  const canUpdate = can(user, "inventory.nutrition.update");
  const batches = useRows(orgSlug, "feed-batches", canRead);
  const inputs = useRows(orgSlug, "feed-batch-inputs", canRead);
  const harvests = useQuery({
    queryKey: ["feed-manufacturing-harvests", orgSlug, siteFilter ?? "all"],
    queryFn: () =>
      agricultureApi.list<{ records: Row[] }>(orgSlug, "harvest", {
        siteId: siteFilter || undefined,
        limit: 200,
      }),
    select: (data) => data.records,
    enabled: canRead && can(user, "agriculture.harvest.read"),
  });
  const [dialog, setDialog] = useState<
    { kind: "batch" } | { kind: "ingredient"; batch: Row } | null
  >(null);
  const visibleBatches = (batches.data ?? []).filter(
    (batch) => !siteFilter || text(batch.siteId) === siteFilter,
  );
  const inputsByBatch = new Map<string, Row[]>();
  for (const input of inputs.data ?? []) {
    const key = text(input.batchId);
    if (!key) continue;
    const current = inputsByBatch.get(key) ?? [];
    current.push(input);
    inputsByBatch.set(key, current);
  }
  const itemById = new Map(items.map((item) => [text(item.id), item]));
  const warehouseById = new Map(
    warehouses.map((warehouse) => [text(warehouse.id), warehouse]),
  );
  const siteById = new Map(sites.map((site) => [text(site.id), site]));
  const batchSave = useMutation({
    mutationFn: (body: ManagementBody) =>
      ownerManagementApi.create(orgSlug, "feed-batches", body),
    onSuccess: () => {
      setDialog(null);
      void client.invalidateQueries({ queryKey: ["operations", orgSlug] });
      void client.invalidateQueries({ queryKey: ["sales", orgSlug] });
    },
  });
  const ingredientSave = useMutation({
    mutationFn: (body: ManagementBody) =>
      ownerManagementApi.create(orgSlug, "feed-batch-inputs", body),
    onSuccess: () => {
      setDialog(null);
      void client.invalidateQueries({ queryKey: ["operations", orgSlug] });
    },
  });
  const changeStatus = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: "confirmed" | "cancelled";
    }) => ownerManagementApi.update(orgSlug, "feed-batches", id, { status }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["operations", orgSlug] });
      void client.invalidateQueries({ queryKey: ["sales", orgSlug] });
    },
  });
  const batchFields: FormField[] = [
    {
      key: "siteId",
      label: copy(fr, "Production site", "Site de fabrication"),
      type: "select",
      required: true,
      defaultValue: siteFilter ?? "",
      options: selectOptions(sites, ["name", "code"]),
      emptyLabel: copy(fr, "No site available", "Aucun site disponible"),
    },
    {
      key: "warehouseId",
      label: copy(fr, "Finished-feed warehouse", "Entrepôt des sacs fabriqués"),
      type: "select",
      required: true,
      options: warehouses.map((warehouse) => {
        const site = siteById.get(text(warehouse.siteId));
        return {
          value: text(warehouse.id),
          label: [text(warehouse.name), text(site?.name)]
            .filter(Boolean)
            .join(" · "),
        };
      }),
      emptyLabel: copy(
        fr,
        "No warehouse available",
        "Aucun entrepôt disponible",
      ),
      hint: copy(
        fr,
        "This warehouse receives the finished bags.",
        "Cet entrepôt recevra les sacs fabriqués.",
      ),
    },
    {
      key: "projectId",
      label: copy(fr, "Linked project", "Projet lié"),
      type: "select",
      options: selectOptions(projects, ["name", "code"]),
      noneLabel: copy(fr, "No project", "Aucun projet"),
      hint: copy(
        fr,
        "Optional. Use it when the harvest and feed belong to one investment.",
        "Facultatif. Utilisez-le lorsque la récolte et l’aliment appartiennent au même investissement.",
      ),
    },
    {
      key: "feedName",
      label: copy(fr, "Finished feed name", "Nom de l’aliment fabriqué"),
      required: true,
      hint: copy(
        fr,
        "An inventory item in kilograms is created automatically when the batch is confirmed.",
        "Un article de stock en kilogrammes est créé automatiquement à la confirmation.",
      ),
    },
    {
      key: "targetSpecies",
      label: copy(fr, "For", "Destiné à"),
      type: "select",
      required: true,
      defaultValue: "poultry",
      options: [
        { value: "poultry", label: copy(fr, "Poultry", "Volaille") },
        { value: "pigs", label: copy(fr, "Pigs", "Porcs") },
        {
          value: "mixed",
          label: copy(fr, "Poultry and pigs", "Volaille et porcs"),
        },
      ],
    },
    {
      key: "productionDate",
      label: copy(fr, "Production date", "Date de fabrication"),
      type: "date",
      required: true,
      defaultValue: today(),
    },
    {
      key: "outputQuantityKg",
      label: copy(fr, "Finished quantity (kg)", "Quantité produite (kg)"),
      type: "number",
      step: "0.001",
      required: true,
    },
    {
      key: "bagWeightKg",
      label: copy(fr, "Weight per bag (kg)", "Poids par sac (kg)"),
      hint: copy(
        fr,
        "The number of bags is calculated automatically from the quantity produced.",
        "Le nombre de sacs est calculé automatiquement à partir de la quantité produite.",
      ),
      type: "number",
      step: "0.001",
      required: true,
      defaultValue: 50,
    },
    { key: "notes", label: copy(fr, "Notes", "Notes"), type: "textarea" },
  ];
  const harvestOptions = (harvests.data ?? []).map((harvest) => ({
    value: text(harvest.id),
    label: [
      text(harvest.cropName),
      text(harvest.plantingName),
      `${amount(harvest.quantity) - amount(harvest.rejectedQuantity)} kg`,
      date(harvest.harvestDate),
    ]
      .filter(Boolean)
      .join(" · "),
  }));
  const ingredientFields = (batch: Row): FormField[] => [
    {
      key: "sourceType",
      label: copy(fr, "Ingredient source", "Source de l’ingrédient"),
      type: "select",
      required: true,
      defaultValue: "harvest",
      options: [
        {
          value: "harvest",
          label: copy(fr, "Agricultural harvest", "Récolte agricole"),
        },
        {
          value: "inventory",
          label: copy(fr, "Existing stock", "Stock existant"),
        },
      ],
      hint: copy(
        fr,
        "For a harvest, choose only the harvest below. For stock, choose only the item and its warehouse.",
        "Pour une récolte, choisissez seulement la récolte ci-dessous. Pour le stock, choisissez seulement l’article et son entrepôt.",
      ),
    },
    {
      key: "harvestRecordId",
      label: copy(fr, "Harvest", "Récolte"),
      type: "select",
      options: harvestOptions,
      noneLabel: copy(fr, "No harvest selected", "Aucune récolte sélectionnée"),
      emptyLabel: copy(
        fr,
        "No kilogram harvest available",
        "Aucune récolte en kilogrammes disponible",
      ),
    },
    {
      key: "inventoryItemId",
      label: copy(fr, "Stocked ingredient", "Ingrédient en stock"),
      type: "select",
      options: items
        .filter((item) => text(item.unit).toLowerCase() === "kg")
        .map((item) => ({
          value: text(item.id),
          label: `${text(item.name)} · kg`,
        })),
      noneLabel: copy(
        fr,
        "No stock item selected",
        "Aucun article de stock sélectionné",
      ),
    },
    {
      key: "warehouseId",
      label: copy(fr, "Ingredient warehouse", "Entrepôt de l’ingrédient"),
      type: "select",
      options: warehouses.map((warehouse) => {
        const site = siteById.get(text(warehouse.siteId));
        return {
          value: text(warehouse.id),
          label: [text(warehouse.name), text(site?.name)]
            .filter(Boolean)
            .join(" · "),
        };
      }),
      noneLabel: copy(
        fr,
        "No warehouse selected",
        "Aucun entrepôt sélectionné",
      ),
    },
    {
      key: "quantityKg",
      label: copy(fr, "Quantity used (kg)", "Quantité utilisée (kg)"),
      type: "number",
      step: "0.001",
      required: true,
    },
    {
      key: "unitCost",
      label: copy(fr, "Unit cost (optional)", "Coût unitaire (facultatif)"),
      type: "number",
      step: "0.01",
      hint: copy(
        fr,
        "Leave blank to use the stock item’s standard cost; use a cost here to value an own harvest.",
        "Laissez vide pour utiliser le coût standard du stock ; saisissez le coût d’une récolte interne ici si nécessaire.",
      ),
    },
    { key: "notes", label: copy(fr, "Notes", "Notes"), type: "textarea" },
  ];
  const statusLabel = (status: unknown) => {
    const value = text(status) || "draft";
    const labels: Record<string, [string, string]> = {
      draft: ["Draft", "Brouillon"],
      confirmed: ["Confirmed", "Confirmée"],
      cancelled: ["Cancelled", "Annulée"],
    };
    return fr
      ? (labels[value]?.[1] ?? nice(value))
      : (labels[value]?.[0] ?? nice(value));
  };
  return (
    <Panel
      title={copy(fr, "Feed manufacturing", "Fabrication d’aliment")}
      description={copy(
        fr,
        "Harvest → ingredients → finished feed in bags → controlled issue to poultry or pigs. Confirming a batch moves stock only once.",
        "Récolte → ingrédients → aliment fini en sacs → distribution contrôlée aux poules ou porcs. La confirmation déplace le stock une seule fois.",
      )}
      action={
        canCreate ? (
          <Button onClick={() => setDialog({ kind: "batch" })}>
            <Plus />
            {copy(fr, "Make feed", "Fabriquer un aliment")}
          </Button>
        ) : undefined
      }
    >
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {[
          [
            copy(fr, "1. Harvest", "1. Récolte"),
            copy(
              fr,
              "Maize, soy, cassava or another crop measured in kg.",
              "Maïs, soja, manioc ou autre récolte en kg.",
            ),
          ],
          [
            copy(fr, "2. Batch", "2. Fabrication"),
            copy(
              fr,
              "Record ingredients and the real kilograms produced.",
              "Enregistrez les ingrédients et les kilogrammes réellement produits.",
            ),
          ],
          [
            copy(fr, "3. Bags for feed", "3. Sacs pour l’élevage"),
            copy(
              fr,
              "The confirmed product enters stock and is then issued to livestock.",
              "Le produit confirmé entre en stock puis est distribué à l’élevage.",
            ),
          ],
        ].map(([title, description]) => (
          <div
            key={title}
            className="rounded-xl border border-brand/15 bg-brand/[0.045] p-3"
          >
            <p className="text-sm font-semibold text-ink">{title}</p>
            <p className="mt-1 text-xs leading-5 text-ink-secondary">
              {description}
            </p>
          </div>
        ))}
      </div>
      {batches.isPending ? <Skeleton className="mt-4 h-32" /> : null}
      {batches.isError ? (
        <ErrorState
          title={copy(
            fr,
            "Could not load feed batches",
            "Impossible de charger les lots d’aliment",
          )}
          onRetry={() => void batches.refetch()}
        />
      ) : null}
      {!batches.isPending && !batches.isError && !visibleBatches.length ? (
        <EmptyState
          title={copy(fr, "No feed batch", "Aucun lot d’aliment")}
          description={copy(
            fr,
            "Create a draft, add harvested or stocked ingredients, then confirm the number of bags produced.",
            "Créez un brouillon, ajoutez les ingrédients récoltés ou en stock, puis confirmez les sacs produits.",
          )}
        />
      ) : null}
      {visibleBatches.length ? (
        <div className="mt-4 max-h-[38rem] space-y-3 overflow-y-auto pr-1">
          {visibleBatches.map((batch) => {
            const batchInputs = inputsByBatch.get(text(batch.id)) ?? [];
            const output = itemById.get(text(batch.outputItemId));
            const outputWarehouse = warehouseById.get(text(batch.warehouseId));
            const isDraft = text(batch.status || "draft") === "draft";
            return (
              <article
                key={text(batch.id)}
                className="rounded-2xl border border-border bg-surface-2/45 p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-ink">
                        {text(batch.feedName)}
                      </p>
                      <Badge
                        variant={
                          text(batch.status) === "confirmed"
                            ? "good"
                            : text(batch.status) === "cancelled"
                              ? "serious"
                              : "warning"
                        }
                      >
                        {statusLabel(batch.status)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-ink-secondary">
                      {text(batch.batchNumber)} · {date(batch.productionDate)} ·{" "}
                      {text(outputWarehouse?.name) ||
                        copy(fr, "Warehouse pending", "Entrepôt à confirmer")}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {isDraft && canCreate ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setDialog({ kind: "ingredient", batch })}
                      >
                        <Plus />
                        {copy(fr, "Add ingredient", "Ajouter un ingrédient")}
                      </Button>
                    ) : null}
                    {isDraft && canUpdate && batchInputs.length ? (
                      <Button
                        size="sm"
                        onClick={() =>
                          changeStatus.mutate({
                            id: text(batch.id),
                            status: "confirmed",
                          })
                        }
                        loading={changeStatus.isPending}
                      >
                        {copy(fr, "Confirm batch", "Confirmer la fabrication")}
                      </Button>
                    ) : null}
                    {text(batch.status) === "confirmed" && canUpdate ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          changeStatus.mutate({
                            id: text(batch.id),
                            status: "cancelled",
                          })
                        }
                        loading={changeStatus.isPending}
                      >
                        {copy(fr, "Cancel batch", "Annuler le lot")}
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-4">
                  <div className="rounded-xl border border-brand/15 bg-brand/10 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-brand">
                      {copy(fr, "Output", "Produit")}
                    </p>
                    <p className="mt-1 text-sm font-bold text-ink">
                      {amount(batch.outputQuantityKg).toLocaleString(
                        fr ? "fr-FR" : "en-US",
                      )}{" "}
                      kg
                    </p>
                  </div>
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.08] px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                      {copy(fr, "Bags", "Sacs")}
                    </p>
                    <p className="mt-1 text-sm font-bold text-ink">
                      {amount(batch.bagCount).toLocaleString(
                        fr ? "fr-FR" : "en-US",
                      )}{" "}
                      × {amount(batch.bagWeightKg)} kg
                    </p>
                  </div>
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.08] px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                      {copy(fr, "Ingredients", "Ingrédients")}
                    </p>
                    <p className="mt-1 text-sm font-bold text-ink">
                      {batchInputs.length}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-surface-1 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                      {copy(fr, "Stock item", "Article de stock")}
                    </p>
                    <p className="mt-1 truncate text-sm font-semibold text-ink">
                      {text(output?.name) ||
                        (isDraft
                          ? copy(
                              fr,
                              "Created on confirmation",
                              "Créé à la confirmation",
                            )
                          : "—")}
                    </p>
                  </div>
                </div>
                {batchInputs.length ? (
                  <div className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface-1 px-3">
                    {batchInputs.map((input) => {
                      const stock = itemById.get(text(input.inventoryItemId));
                      const harvest = (harvests.data ?? []).find(
                        (entry) =>
                          text(entry.id) === text(input.harvestRecordId),
                      );
                      return (
                        <div
                          key={text(input.id)}
                          className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
                        >
                          <span className="min-w-0 truncate font-medium text-ink">
                            {text(input.sourceType) === "harvest"
                              ? [
                                  text(harvest?.cropName),
                                  text(harvest?.plantingName),
                                ]
                                  .filter(Boolean)
                                  .join(" · ") ||
                                copy(
                                  fr,
                                  "Agricultural harvest",
                                  "Récolte agricole",
                                )
                              : text(stock?.name) ||
                                copy(
                                  fr,
                                  "Stocked ingredient",
                                  "Ingrédient en stock",
                                )}
                          </span>
                          <span className="shrink-0 rounded-md bg-surface-2 px-2 py-1 text-xs font-semibold text-ink-secondary">
                            {amount(input.quantityKg).toLocaleString(
                              fr ? "fr-FR" : "en-US",
                            )}{" "}
                            kg
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-3 rounded-xl border border-dashed border-warning/35 bg-warning/5 px-3 py-2 text-xs leading-5 text-warning-ink">
                    {copy(
                      fr,
                      "Add at least one ingredient before confirming this batch.",
                      "Ajoutez au moins un ingrédient avant de confirmer ce lot.",
                    )}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      ) : null}
      {dialog?.kind === "batch" ? (
        <Editor
          title={copy(fr, "Make feed", "Fabriquer un aliment")}
          subtitle={copy(fr, "Inventory", "Inventaire")}
          fields={batchFields}
          pending={batchSave.isPending}
          error={batchSave.error}
          close={() => setDialog(null)}
          save={batchSave.mutate}
          fr={fr}
        />
      ) : null}
      {dialog?.kind === "ingredient" ? (
        <Editor
          title={copy(fr, "Add feed ingredient", "Ajouter un ingrédient")}
          subtitle={`${text(dialog.batch.batchNumber)} · ${text(dialog.batch.feedName)}`}
          defaults={{ batchId: text(dialog.batch.id) }}
          fields={ingredientFields(dialog.batch)}
          pending={ingredientSave.isPending}
          error={ingredientSave.error}
          close={() => setDialog(null)}
          save={(body) =>
            ingredientSave.mutate({ ...body, batchId: text(dialog.batch.id) })
          }
          fr={fr}
        />
      ) : null}
    </Panel>
  );
}
type FeedNutritionOverview = {
  totals: {
    dailyKg: number;
    sevenDaysKg: number;
    thirtyDaysKg: number;
    heads: number;
  };
  requirements: Array<{
    species: "poultry" | "pigs";
    sourceId: string | null;
    sourceName: string;
    siteName: string;
    profileCode: string | null;
    profileName: string;
    headCount: number;
    dailyKg: number;
    sevenDaysKg: number;
    thirtyDaysKg: number;
    rationMode: "rationed" | "ad_libitum" | null;
  }>;
  profiles: Array<{
    id: string;
    code: string;
    species: string;
    stage: string;
    daily_ration_kg: string;
    ration_mode: string;
    benchmark_fcr: string | null;
  }>;
  fcr: Array<{
    kind: string;
    feedKg: number;
    outputKg: number;
    fcr: number | null;
    benchmark: number;
    warning: boolean;
  }>;
  finishedFeedStock: {
    quantityKg: number;
    inventoryValue: number;
    autonomyDays: number | null;
  };
  activeRecipes: number;
  openProductionOrders: number;
  alerts: Array<{ kind: string; priority: string; message: string }>;
  assistant: string;
};

const feedUnitToKg = (unit: unknown) => {
  const value = text(unit).toLowerCase();
  if (["kg", "kilogram", "kilogramme"].includes(value)) return 1;
  if (["g", "gram", "gramme"].includes(value)) return 0.001;
  if (["bag_50", "sac_50", "50kg", "50 kg", "sac 50 kg"].includes(value))
    return 50;
  // A recipe can only use a measured feed ingredient. Unknown units such as
  // feuille/pièce must never be treated as kilograms.
  return 0;
};

function FeedMillWorkspace({
  orgSlug,
  fr,
  tab = "raw-materials",
}: {
  orgSlug: string;
  fr: boolean;
  tab?: "raw-materials" | "recipes" | "production-orders" | "planning";
}) {
  const user = useSessionUser();
  const client = useQueryClient();
  const canRead = can(user, "inventory.nutrition.read");
  const canCreate = can(user, "inventory.nutrition.create");
  const canUpdate = can(user, "inventory.nutrition.update");
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
  const projects = useRows(orgSlug, "projects", can(user, "projects.read"));
  const recipes = useRows(orgSlug, "feed-recipes", canRead);
  const recipeLines = useRows(orgSlug, "feed-recipe-lines", canRead);
  const orders = useRows(orgSlug, "feed-orders", canRead);
  const refs = useReferences(orgSlug, can(user, "sites.read"));
  const overview = useQuery({
    queryKey: ["feed-nutrition", orgSlug, "overview"],
    queryFn: () =>
      ownerManagementApi.feedNutritionOverview<FeedNutritionOverview>(orgSlug),
    enabled: canRead,
  });
  const [dialog, setDialog] = useState<
    | { kind: "recipe" }
    | { kind: "line"; recipe: Row }
    | { kind: "order" }
    | null
  >(null);
  const [previewKg, setPreviewKg] = useState<Record<string, string>>({});
  // Only mass-based stock can become an ingredient. Construction units such as
  // sheets or pieces stay in Inventory and never appear in the feed mill.
  // A mass unit is necessary but not sufficient: the inventory category must
  // explicitly say that this is a feed-mill ingredient. Construction, spare
  // parts, and products for sale remain visible only in Inventory.
  const feedIngredients = (items.data ?? []).filter(
    (item) =>
      feedUnitToKg(item.unit) > 0 && feedIngredientCategory(item.category),
  );
  const finishedFeedItems = (items.data ?? []).filter((item) =>
    feedFinishedCategory(item.category),
  );
  const itemById = new Map(
    (items.data ?? []).map((item) => [text(item.id), item]),
  );
  const siteById = new Map(
    (refs.sites.data ?? []).map((site) => [text(site.id), site]),
  );
  const recipeById = new Map(
    (recipes.data ?? []).map((recipe) => [text(recipe.id), recipe]),
  );
  const linesByRecipe = new Map<string, Row[]>();
  for (const line of recipeLines.data ?? []) {
    const recipeId = text(line.recipeId);
    if (!recipeId) continue;
    linesByRecipe.set(recipeId, [...(linesByRecipe.get(recipeId) ?? []), line]);
  }
  const saveRecipe = useMutation({
    mutationFn: (body: ManagementBody) =>
      ownerManagementApi.create(orgSlug, "feed-recipes", body),
    onSuccess: () => {
      setDialog(null);
      void client.invalidateQueries({ queryKey: ["operations", orgSlug] });
      void client.invalidateQueries({ queryKey: ["feed-nutrition", orgSlug] });
    },
  });
  const saveRecipeLine = useMutation({
    mutationFn: (body: ManagementBody) =>
      ownerManagementApi.create(orgSlug, "feed-recipe-lines", body),
    onSuccess: () => {
      setDialog(null);
      void client.invalidateQueries({ queryKey: ["operations", orgSlug] });
      void client.invalidateQueries({ queryKey: ["feed-nutrition", orgSlug] });
    },
  });
  const saveOrder = useMutation({
    mutationFn: (body: ManagementBody) =>
      ownerManagementApi.create(orgSlug, "feed-orders", body),
    onSuccess: () => {
      setDialog(null);
      void client.invalidateQueries({ queryKey: ["operations", orgSlug] });
      void client.invalidateQueries({ queryKey: ["feed-nutrition", orgSlug] });
    },
  });
  const confirmOrder = useMutation({
    mutationFn: (id: string) =>
      ownerManagementApi.confirmFeedOrder(orgSlug, id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["operations", orgSlug] });
      void client.invalidateQueries({ queryKey: ["feed-nutrition", orgSlug] });
      void client.invalidateQueries({ queryKey: ["sales", orgSlug] });
    },
  });
  const cancelOrder = useMutation({
    mutationFn: (id: string) => ownerManagementApi.cancelFeedOrder(orgSlug, id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["operations", orgSlug] });
      void client.invalidateQueries({ queryKey: ["feed-nutrition", orgSlug] });
      void client.invalidateQueries({ queryKey: ["sales", orgSlug] });
    },
  });
  const tabs: Array<{ key: typeof tab; label: string; href: string }> = [
    {
      key: "raw-materials",
      label: copy(
        fr,
        "Raw materials & harvests",
        "Matières premières & récoltes",
      ),
      href: `/${orgSlug}/feed-mill/raw-materials`,
    },
    {
      key: "recipes",
      label: copy(fr, "Formulations & recipes", "Formulation & recettes"),
      href: `/${orgSlug}/feed-mill/recipes`,
    },
    {
      key: "production-orders",
      label: copy(fr, "Production orders", "Ordres de fabrication"),
      href: `/${orgSlug}/feed-mill/production-orders`,
    },
    {
      key: "planning",
      label: copy(fr, "Planning & requirements", "Planification & besoins"),
      href: `/${orgSlug}/feed-mill/planning`,
    },
  ];
  const recipeFields: FormField[] = [
    {
      key: "name",
      label: copy(fr, "Recipe name", "Nom de la recette"),
      required: true,
    },
    {
      key: "targetSpecies",
      label: copy(fr, "Target species", "Espèce ciblée"),
      type: "select",
      required: true,
      defaultValue: "poultry",
      options: [
        { value: "poultry", label: copy(fr, "Poultry", "Volaille") },
        { value: "pigs", label: copy(fr, "Pigs", "Porcs") },
        { value: "mixed", label: copy(fr, "Both", "Les deux") },
      ],
    },
    {
      key: "feedStage",
      label: copy(fr, "Feed stage", "Stade alimentaire"),
      hint: copy(
        fr,
        "For example: starter, grower, finisher or layer.",
        "Exemple : démarrage, croissance, finition ou ponte.",
      ),
    },
    {
      key: "baseQuantityKg",
      label: copy(fr, "Standard batch (kg)", "Lot standard (kg)"),
      type: "number",
      step: "0.001",
      required: true,
      defaultValue: 100,
      hint: copy(
        fr,
        "Recipes can be made per 100 kg or per tonne.",
        "La recette peut être définie pour 100 kg ou une tonne.",
      ),
    },
    {
      key: "overheadPerKg",
      label: copy(
        fr,
        "Grinding/mixing cost per kg",
        "Coût broyage/mélange par kg",
      ),
      type: "number",
      step: "0.0001",
      defaultValue: 0,
      hint: copy(
        fr,
        "Labour, electricity, milling or bags; included in the finished-feed cost.",
        "Main-d’œuvre, électricité, broyage ou sacs ; inclus dans le coût de l’aliment fini.",
      ),
    },
    { key: "notes", label: copy(fr, "Notes", "Notes"), type: "textarea" },
  ];
  const lineFields = (recipe: Row): FormField[] => [
    {
      key: "inventoryItemId",
      label: copy(fr, "Stocked ingredient", "Ingrédient en stock"),
      type: "select",
      options: feedIngredients.map((item) => ({
        value: text(item.id),
        label: `${text(item.name)} · ${inventoryCategoryName(item.category, fr)} · ${text(item.unit)}`,
      })),
      noneLabel: copy(fr, "Choose later", "Choisir plus tard"),
      hint: copy(
        fr,
        "Link the exact stock item so confirmation can deduct it automatically.",
        "Liez l’article exact afin que la confirmation le déduise automatiquement.",
      ),
    },
    {
      key: "ingredientName",
      label: copy(fr, "Ingredient name", "Nom de l’ingrédient"),
      required: true,
    },
    {
      key: "unit",
      label: copy(fr, "Recipe unit", "Unité de recette"),
      type: "select",
      required: true,
      defaultValue: "kg",
      options: [
        { value: "kg", label: "kg" },
        { value: "g", label: "g" },
        { value: "bag_50", label: copy(fr, "50 kg bag", "Sac de 50 kg") },
      ],
    },
    {
      key: "quantityPerBase",
      label: `${copy(fr, "Quantity for", "Quantité pour")} ${amount(recipe.baseQuantityKg || 100).toLocaleString(fr ? "fr-FR" : "en-US")} kg`,
      type: "number",
      required: true,
      step: "0.0001",
    },
    {
      key: "unitCostOverride",
      label: copy(
        fr,
        "Cost override (optional)",
        "Coût personnalisé (facultatif)",
      ),
      type: "number",
      step: "0.0001",
      hint: copy(
        fr,
        "Leave empty to use the weighted inventory cost.",
        "Laissez vide pour utiliser le coût pondéré du stock.",
      ),
    },
    { key: "notes", label: copy(fr, "Notes", "Notes"), type: "textarea" },
  ];
  const orderFields: FormField[] = [
    {
      key: "recipeId",
      label: copy(fr, "Recipe", "Recette"),
      type: "select",
      required: true,
      options: (recipes.data ?? [])
        .filter((recipe) => recipe.isActive !== false)
        .map((recipe) => ({
          value: text(recipe.id),
          label: `${text(recipe.name)} · ${amount(recipe.baseQuantityKg || 100)} kg`,
        })),
      emptyLabel: copy(
        fr,
        "Create a recipe first",
        "Créez d’abord une recette",
      ),
    },
    {
      key: "siteId",
      label: copy(fr, "Production site", "Site de fabrication"),
      type: "select",
      required: true,
      options: selectOptions(refs.sites.data ?? [], ["name", "code"]),
      emptyLabel: copy(fr, "No site available", "Aucun site disponible"),
    },
    {
      key: "inputWarehouseId",
      label: copy(fr, "Ingredient warehouse", "Entrepôt des ingrédients"),
      type: "select",
      required: true,
      options: (warehouses.data ?? []).map((warehouse) => ({
        value: text(warehouse.id),
        label: `${text(warehouse.name)} · ${text(siteById.get(text(warehouse.siteId))?.name)}`,
      })),
      emptyLabel: copy(
        fr,
        "Create a warehouse first",
        "Créez d’abord un entrepôt",
      ),
    },
    {
      key: "outputWarehouseId",
      label: copy(fr, "Finished-feed warehouse", "Entrepôt de l’aliment fini"),
      type: "select",
      required: true,
      options: (warehouses.data ?? []).map((warehouse) => ({
        value: text(warehouse.id),
        label: `${text(warehouse.name)} · ${text(siteById.get(text(warehouse.siteId))?.name)}`,
      })),
      emptyLabel: copy(
        fr,
        "Create a warehouse first",
        "Créez d’abord un entrepôt",
      ),
    },
    {
      key: "projectId",
      label: copy(fr, "Linked project", "Projet lié"),
      type: "select",
      options: selectOptions(projects.data ?? [], ["name", "code"]),
      noneLabel: copy(fr, "No project", "Aucun projet"),
    },
    {
      key: "plannedQuantityKg",
      label: copy(fr, "Target quantity (kg)", "Quantité à produire (kg)"),
      type: "number",
      step: "0.001",
      required: true,
    },
    {
      key: "bagWeightKg",
      label: copy(fr, "Bag weight (kg)", "Poids par sac (kg)"),
      type: "number",
      step: "0.001",
      required: true,
      defaultValue: 50,
    },
    {
      key: "overheadTotal",
      label: copy(
        fr,
        "Additional production cost",
        "Coût complémentaire de fabrication",
      ),
      type: "number",
      step: "0.01",
      defaultValue: 0,
      hint: copy(
        fr,
        "Optional total for this one run; recipe overhead is also applied.",
        "Total facultatif pour cet OF ; le coût de recette est aussi appliqué.",
      ),
    },
    {
      key: "productionDate",
      label: copy(fr, "Production date", "Date de fabrication"),
      type: "date",
      required: true,
      defaultValue: today(),
    },
    { key: "notes", label: copy(fr, "Notes", "Notes"), type: "textarea" },
  ];
  const makeRecipeCost = (recipe: Row, targetKg: number) => {
    const base = amount(recipe.baseQuantityKg || 100);
    const ratio = base > 0 ? targetKg / base : 0;
    const ingredientCost = (linesByRecipe.get(text(recipe.id)) ?? []).reduce(
      (total, line) => {
        const item = itemById.get(text(line.inventoryItemId));
        const lineKg =
          amount(line.quantityPerBase) * feedUnitToKg(line.unit) * ratio;
        const nativeCost =
          line.unitCostOverride == null
            ? amount(item?.standardUnitCost)
            : amount(line.unitCostOverride);
        const unitKg = feedUnitToKg(item?.unit || line.unit);
        return total + lineKg * (unitKg > 0 ? nativeCost / unitKg : 0);
      },
      0,
    );
    return ingredientCost + targetKg * amount(recipe.overheadPerKg);
  };
  const unitLabel = (value: unknown) =>
    text(value) === "bag_50"
      ? copy(fr, "50 kg bag", "Sac de 50 kg")
      : text(value);
  const statusLabel = (value: unknown) => {
    const key = text(value) || "draft";
    const labels: Record<string, [string, string]> = {
      draft: ["Draft", "Brouillon"],
      in_progress: ["In progress", "En cours"],
      confirmed: ["Confirmed", "Confirmé"],
      cancelled: ["Cancelled", "Annulé"],
    };
    return fr
      ? (labels[key]?.[1] ?? nice(key))
      : (labels[key]?.[0] ?? nice(key));
  };
  return (
    <main className="feed-mill-workspace mx-auto max-w-7xl space-y-5 p-4 text-ink sm:p-6 lg:p-8">
      <Header
        icon={Factory}
        title={copy(fr, "Feed mill & nutrition", "Provenderie & nutrition")}
        description={copy(
          fr,
          "Plan farm-wide feeding, turn harvests and raw materials into traceable feed, then distribute the finished bags to poultry and pigs.",
          "Planifiez l’alimentation de toute l’exploitation, transformez récoltes et matières premières en aliment traçable, puis distribuez les sacs finis aux volailles et aux porcs.",
        )}
      />
      <nav
        className="feed-mill-tabs flex max-w-full gap-2 overflow-x-auto rounded-2xl border border-slate-300 bg-white p-2 shadow-sm dark:border-white/15 dark:bg-[#1a1a19]"
        aria-label={copy(
          fr,
          "Feed-mill sections",
          "Sections de la provenderie",
        )}
      >
        {tabs.map((item) => (
          <a
            key={item.key}
            href={item.href}
            className={`shrink-0 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${tab === item.key ? "bg-[#184f95] text-white shadow-sm hover:bg-[#0d366b] dark:bg-[#6da7ec] dark:text-[#0b0b0b] dark:hover:bg-[#86b6ef]" : "bg-white text-slate-800 hover:bg-blue-50 hover:text-[#0d366b] dark:bg-[#1a1a19] dark:text-slate-100 dark:hover:bg-white/10 dark:hover:text-white"}`}
          >
            {item.label}
          </a>
        ))}
      </nav>
      {tab === "raw-materials" ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Metric
              label={copy(
                fr,
                "Feed-stock items",
                "Articles d’aliment en stock",
              )}
              value={String(finishedFeedItems.length)}
            />
            <Metric
              label={copy(
                fr,
                "Ingredient warehouses",
                "Entrepôts d’ingrédients",
              )}
              value={String((warehouses.data ?? []).length)}
            />
            <Metric
              label={copy(fr, "Feed autonomy", "Autonomie d’aliment")}
              value={
                overview.data?.finishedFeedStock.autonomyDays == null
                  ? "—"
                  : `${overview.data.finishedFeedStock.autonomyDays.toFixed(1)} ${copy(fr, "days", "jours")}`
              }
              warning={
                (overview.data?.finishedFeedStock.autonomyDays ?? 99) < 3
              }
            />
          </div>
          <Panel
            title={copy(
              fr,
              "Raw materials & harvests",
              "Matières premières & récoltes",
            )}
            description={copy(
              fr,
              "Only stock explicitly classified for the Feed mill appears here. Use one of these stocked ingredients in a recipe so its exact quantity is deducted at confirmation.",
              "Seuls les stocks explicitement classés pour la Provenderie apparaissent ici. Utilisez l’un de ces ingrédients dans une recette afin que sa quantité exacte soit déduite à la confirmation.",
            )}
          >
            <div className="mb-4 rounded-xl border border-emerald-500/25 bg-emerald-500/[.08] px-3 py-3 text-sm text-ink dark:bg-emerald-400/10">
              <p className="font-semibold">
                {copy(
                  fr,
                  "How an ingredient enters this list",
                  "Comment un ingrédient entre dans cette liste",
                )}
              </p>
              <p className="mt-1 text-ink-secondary">
                {copy(
                  fr,
                  "In Inventory, choose Feed mill · raw material for maize, soy, cassava or bran; choose Feed mill · additive / mineral for premix, salt, limestone, lysine or methionine. Construction items, such as roofing sheets, never appear here.",
                  "Dans Stocks, choisissez Provenderie · matière première pour le maïs, le soja, le manioc ou le son ; choisissez Provenderie · additif / minéral pour le prémix, le sel, le calcaire, la lysine ou la méthionine. Les articles de construction, comme les tôles, n’apparaissent jamais ici.",
                )}
              </p>
            </div>
            {feedIngredients.length ? (
              <div className="max-h-[34rem] divide-y divide-border overflow-y-auto rounded-2xl border border-border bg-surface-1">
                {feedIngredients.map((item) => (
                  <div
                    key={text(item.id)}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div>
                      <p className="font-semibold text-ink">
                        {text(item.name)}
                      </p>
                      <p className="text-xs text-ink-secondary">
                        {inventoryCategoryName(item.category, fr)} ·{" "}
                        {text(item.unit)}
                      </p>
                    </div>
                    <span className="rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-200">
                      {copy(
                        fr,
                        "Feed-mill ingredient",
                        "Ingrédient de provenderie",
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title={copy(
                  fr,
                  "No feed ingredient yet",
                  "Aucun ingrédient de provenderie",
                )}
                description={copy(
                  fr,
                  "In Inventory, create or edit an item, give it a mass unit (kg, g or 50 kg bag), then choose Feed mill · raw material or Feed mill · additive / mineral.",
                  "Dans Stocks, créez ou modifiez un article, donnez-lui une unité de masse (kg, g ou sac de 50 kg), puis choisissez Provenderie · matière première ou Provenderie · additif / minéral.",
                )}
              />
            )}
          </Panel>
        </>
      ) : null}
      {tab === "recipes" ? (
        <Panel
          title={copy(fr, "Formulations & recipes", "Formulation & recettes")}
          description={copy(
            fr,
            "Define a standard formula once, then see its exact scaled quantities and estimated cost for any production run. Macro ingredients use kg or 50 kg bags; minerals and premix can use grams.",
            "Définissez une formule standard, puis consultez ses quantités exactes et son coût estimé pour chaque fabrication. Les macronutriments utilisent kg ou sacs de 50 kg ; les minéraux et prémix peuvent utiliser les grammes.",
          )}
          action={
            canCreate ? (
              <Button onClick={() => setDialog({ kind: "recipe" })}>
                <Plus />
                {copy(fr, "New recipe", "Nouvelle recette")}
              </Button>
            ) : undefined
          }
        >
          {recipes.isPending ? <Skeleton className="h-40" /> : null}
          {recipes.isError ? (
            <ErrorState
              title={copy(
                fr,
                "Could not load recipes",
                "Impossible de charger les recettes",
              )}
              onRetry={() => void recipes.refetch()}
            />
          ) : null}
          {!recipes.isPending &&
          !recipes.isError &&
          !(recipes.data ?? []).length ? (
            <EmptyState
              title={copy(fr, "No feed recipe", "Aucune recette d’aliment")}
              description={copy(
                fr,
                "Create a recipe per 100 kg or one tonne, then add each ingredient.",
                "Créez une recette pour 100 kg ou une tonne, puis ajoutez chaque ingrédient.",
              )}
            />
          ) : null}
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {(recipes.data ?? []).map((recipe) => {
              const target =
                Number(
                  previewKg[text(recipe.id)] ?? recipe.baseQuantityKg ?? 100,
                ) || amount(recipe.baseQuantityKg || 100);
              const estimatedCost = makeRecipeCost(recipe, target);
              const recipeLines = linesByRecipe.get(text(recipe.id)) ?? [];
              return (
                <article
                  key={text(recipe.id)}
                  className="feed-mill-card rounded-2xl border border-slate-300 bg-white p-4 text-slate-950 shadow-sm dark:border-white/10 dark:bg-[#222221] dark:text-white"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">
                        {text(recipe.name)}
                      </p>
                      <p className="mt-1 text-xs text-ink-secondary">
                        {text(recipe.code)} ·{" "}
                        {text(recipe.targetSpecies) === "pigs"
                          ? copy(fr, "Pigs", "Porcs")
                          : text(recipe.targetSpecies) === "mixed"
                            ? copy(fr, "Mixed", "Mixte")
                            : copy(fr, "Poultry", "Volaille")}{" "}
                        · {text(recipe.feedStage) || "—"}
                      </p>
                    </div>
                    {canCreate ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setDialog({ kind: "line", recipe })}
                      >
                        <Plus />
                        {copy(fr, "Ingredient", "Ingrédient")}
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <Field
                      htmlFor={`recipe-preview-${text(recipe.id)}`}
                      label={copy(
                        fr,
                        "Production target (kg)",
                        "Objectif de production (kg)",
                      )}
                    >
                      <Input
                        id={`recipe-preview-${text(recipe.id)}`}
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={String(target)}
                        onChange={(event) =>
                          setPreviewKg((current) => ({
                            ...current,
                            [text(recipe.id)]: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <div className="rounded-xl border border-blue-300 bg-blue-50 px-3 py-2.5 dark:border-blue-400/30 dark:bg-blue-400/15">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#0d366b] dark:text-blue-200">
                        {copy(fr, "Estimated cost", "Coût estimé")}
                      </p>
                      <p className="mt-1 text-lg font-bold text-ink">
                        {estimatedCost.toLocaleString(fr ? "fr-FR" : "en-US", {
                          maximumFractionDigits: 2,
                        })}
                      </p>
                      <p className="text-xs text-ink-secondary">
                        {target > 0
                          ? `${(estimatedCost / target).toLocaleString(fr ? "fr-FR" : "en-US", { maximumFractionDigits: 2 })} / kg · ${((estimatedCost * 50) / target).toLocaleString(fr ? "fr-FR" : "en-US", { maximumFractionDigits: 2 })} / 50 kg`
                          : "—"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 divide-y divide-border rounded-xl border border-border bg-surface-1 px-3">
                    {recipeLines.length ? (
                      recipeLines.map((line) => {
                        const ingredient = itemById.get(
                          text(line.inventoryItemId),
                        );
                        const scaledKg =
                          amount(line.quantityPerBase) *
                          feedUnitToKg(line.unit) *
                          (target /
                            Math.max(amount(recipe.baseQuantityKg), 0.001));
                        return (
                          <div
                            key={text(line.id)}
                            className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                          >
                            <div>
                              <p className="text-sm font-medium text-ink">
                                {text(line.ingredientName) ||
                                  text(ingredient?.name)}
                              </p>
                              <p className="text-xs text-ink-secondary">
                                {amount(line.quantityPerBase).toLocaleString(
                                  fr ? "fr-FR" : "en-US",
                                )}{" "}
                                {unitLabel(line.unit)} /{" "}
                                {amount(recipe.baseQuantityKg)} kg
                              </p>
                            </div>
                            <span className="rounded-md bg-surface-2 px-2 py-1 text-xs font-semibold text-ink-secondary">
                              {scaledKg.toLocaleString(fr ? "fr-FR" : "en-US", {
                                maximumFractionDigits: 3,
                              })}{" "}
                              kg
                            </span>
                          </div>
                        );
                      })
                    ) : (
                      <p className="py-3 text-sm text-ink-secondary">
                        {copy(
                          fr,
                          "No ingredients yet.",
                          "Aucun ingrédient pour le moment.",
                        )}
                      </p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </Panel>
      ) : null}
      {tab === "production-orders" ? (
        <>
          <Panel
            title={copy(
              fr,
              "Production orders / OF",
              "Ordres de fabrication / OF",
            )}
            description={copy(
              fr,
              "An OF scales the recipe to the chosen batch target. Confirmation issues its exact inputs and receives finished feed only once in the same inventory ledger.",
              "Un OF adapte la recette à la quantité choisie. Sa confirmation sort les ingrédients exacts et réceptionne l’aliment fini une seule fois dans le même stock.",
            )}
            action={
              canCreate ? (
                <Button onClick={() => setDialog({ kind: "order" })}>
                  <Plus />
                  {copy(
                    fr,
                    "New production order",
                    "Nouvel ordre de fabrication",
                  )}
                </Button>
              ) : undefined
            }
          >
            {orders.isPending ? <Skeleton className="h-40" /> : null}
            {orders.isError ? (
              <ErrorState
                title={copy(
                  fr,
                  "Could not load production orders",
                  "Impossible de charger les ordres de fabrication",
                )}
                onRetry={() => void orders.refetch()}
              />
            ) : null}
            {!orders.isPending &&
            !orders.isError &&
            !(orders.data ?? []).length ? (
              <EmptyState
                title={copy(
                  fr,
                  "No production order",
                  "Aucun ordre de fabrication",
                )}
                description={copy(
                  fr,
                  "Create a recipe, add its ingredients, then create an OF for the required quantity.",
                  "Créez une recette, ajoutez ses ingrédients, puis créez un OF pour la quantité requise.",
                )}
              />
            ) : null}
            <div className="mt-4 max-h-[40rem] space-y-3 overflow-y-auto pr-1">
              {(orders.data ?? []).map((order) => {
                const recipe = recipeById.get(text(order.recipeId));
                const confirmed = text(order.status) === "confirmed";
                const draft = text(order.status || "draft") === "draft";
                return (
                  <article
                    key={text(order.id)}
                    className="feed-mill-card rounded-2xl border border-slate-300 bg-white p-4 text-slate-950 shadow-sm dark:border-white/10 dark:bg-[#222221] dark:text-white"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-ink">
                            {text(order.orderNumber)}
                          </p>
                          <Badge
                            variant={
                              confirmed
                                ? "good"
                                : text(order.status) === "cancelled"
                                  ? "serious"
                                  : "warning"
                            }
                          >
                            {statusLabel(order.status)}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-ink-secondary">
                          {text(recipe?.name) ||
                            copy(
                              fr,
                              "Recipe unavailable",
                              "Recette indisponible",
                            )}{" "}
                          ·{" "}
                          {amount(order.plannedQuantityKg).toLocaleString(
                            fr ? "fr-FR" : "en-US",
                          )}{" "}
                          kg · {date(order.productionDate)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {draft && canUpdate ? (
                          <Button
                            size="sm"
                            onClick={() => confirmOrder.mutate(text(order.id))}
                            loading={confirmOrder.isPending}
                          >
                            {copy(
                              fr,
                              "Confirm manufacture",
                              "Confirmer la fabrication",
                            )}
                          </Button>
                        ) : null}
                        {confirmed && canUpdate ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => cancelOrder.mutate(text(order.id))}
                            loading={cancelOrder.isPending}
                          >
                            {copy(fr, "Cancel OF", "Annuler l’OF")}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-xl border border-blue-300 bg-blue-50 px-3 py-2 dark:border-blue-400/30 dark:bg-blue-400/15">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#0d366b] dark:text-blue-200">
                          {copy(fr, "Target", "Objectif")}
                        </p>
                        <p className="mt-1 font-bold text-ink">
                          {amount(order.plannedQuantityKg).toLocaleString(
                            fr ? "fr-FR" : "en-US",
                          )}{" "}
                          kg
                        </p>
                      </div>
                      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[.08] px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                          {copy(fr, "Produced", "Produit")}
                        </p>
                        <p className="mt-1 font-bold text-ink">
                          {order.actualQuantityKg == null
                            ? "—"
                            : `${amount(order.actualQuantityKg).toLocaleString(fr ? "fr-FR" : "en-US")} kg`}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border bg-surface-1 px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                          {copy(fr, "Bags", "Sacs")}
                        </p>
                        <p className="mt-1 font-bold text-ink">
                          {amount(order.bagWeightKg || 50)} kg /{" "}
                          {copy(fr, "bag", "sac")}
                        </p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </Panel>
        </>
      ) : null}
      {tab === "planning" ? (
        <>
          <QueryState query={overview}>
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-4">
                <Metric
                  label={copy(fr, "24-hour requirement", "Besoin 24 h")}
                  value={`${(overview.data?.totals.dailyKg ?? 0).toLocaleString(fr ? "fr-FR" : "en-US", { maximumFractionDigits: 1 })} kg`}
                />
                <Metric
                  label={copy(fr, "7-day requirement", "Besoin 7 jours")}
                  value={`${(overview.data?.totals.sevenDaysKg ?? 0).toLocaleString(fr ? "fr-FR" : "en-US", { maximumFractionDigits: 1 })} kg`}
                />
                <Metric
                  label={copy(fr, "30-day requirement", "Besoin 30 jours")}
                  value={`${(overview.data?.totals.thirtyDaysKg ?? 0).toLocaleString(fr ? "fr-FR" : "en-US", { maximumFractionDigits: 1 })} kg`}
                />
                <Metric
                  label={copy(
                    fr,
                    "Finished-feed autonomy",
                    "Autonomie aliment fini",
                  )}
                  value={
                    overview.data?.finishedFeedStock.autonomyDays == null
                      ? "—"
                      : `${overview.data.finishedFeedStock.autonomyDays.toFixed(1)} ${copy(fr, "days", "jours")}`
                  }
                  warning={
                    (overview.data?.finishedFeedStock.autonomyDays ?? 99) < 3
                  }
                />
              </div>
              <Panel
                title={copy(
                  fr,
                  "Farm-wide feed requirements",
                  "Besoins d’aliment de l’exploitation",
                )}
                description={copy(
                  fr,
                  "The current need uses active flock/group counts and the standard profile matched to their type and age. Adjust the profiles if your farm uses a different ration.",
                  "Le besoin actuel utilise les effectifs actifs des lots/groupes et le profil standard correspondant au type et à l’âge. Ajustez les profils si votre ferme utilise une ration différente.",
                )}
              >
                <div className="max-h-[34rem] divide-y divide-border overflow-y-auto rounded-2xl border border-border bg-surface-1">
                  {(overview.data?.requirements ?? []).map((need, index) => (
                    <div
                      key={`${need.species}-${need.sourceId ?? need.sourceName}-${index}`}
                      className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,.7fr))]"
                    >
                      <div>
                        <p className="font-semibold text-ink">
                          {need.sourceName}
                        </p>
                        <p className="text-xs text-ink-secondary">
                          {need.species === "poultry"
                            ? copy(fr, "Poultry", "Volaille")
                            : copy(fr, "Pigs", "Porcs")}{" "}
                          · {need.siteName} · {need.profileName}
                          {need.rationMode === "ad_libitum"
                            ? ` · ${copy(fr, "ad libitum", "à volonté")}`
                            : ""}
                        </p>
                      </div>
                      <p className="text-sm font-semibold text-ink">
                        {need.headCount} {copy(fr, "head", "têtes")}
                      </p>
                      <p className="text-sm font-semibold text-ink">
                        {need.dailyKg.toLocaleString(fr ? "fr-FR" : "en-US", {
                          maximumFractionDigits: 2,
                        })}{" "}
                        kg / 24 h
                      </p>
                      <p className="text-sm font-semibold text-ink">
                        {need.thirtyDaysKg.toLocaleString(
                          fr ? "fr-FR" : "en-US",
                          { maximumFractionDigits: 1 },
                        )}{" "}
                        kg / 30 j
                      </p>
                    </div>
                  ))}
                  {!(overview.data?.requirements ?? []).length ? (
                    <p className="px-4 py-5 text-sm text-ink-secondary">
                      {copy(
                        fr,
                        "No active poultry or pig groups are available yet.",
                        "Aucun lot de volaille ou groupe porcin actif n’est encore disponible.",
                      )}
                    </p>
                  ) : null}
                </div>
              </Panel>
              <Panel
                title={copy(
                  fr,
                  "Feed conversion and monitored signals",
                  "Conversion alimentaire et signaux surveillés",
                )}
                description={copy(
                  fr,
                  "FCR compares recorded feed to real output. A value more than 10% above the benchmark is flagged for review.",
                  "L’IC compare l’aliment enregistré au résultat réel. Une valeur supérieure de plus de 10 % au repère est signalée.",
                )}
              >
                <div className="grid gap-3 md:grid-cols-3">
                  {(overview.data?.fcr ?? []).map((metric) => (
                    <div
                      key={metric.kind}
                      className={`rounded-xl border p-3 ${metric.warning ? "border-warning/40 bg-warning/10" : "border-border bg-surface-2/40"}`}
                    >
                      <p className="text-sm font-semibold text-ink">
                        {metric.kind === "pigs"
                          ? copy(fr, "Pigs", "Porcs")
                          : metric.kind === "layers"
                            ? copy(fr, "Layers", "Pondeuses")
                            : copy(fr, "Broilers", "Poulets de chair")}
                      </p>
                      <p className="mt-2 text-2xl font-bold text-ink">
                        {metric.fcr == null ? "—" : metric.fcr.toFixed(2)}
                      </p>
                      <p className="text-xs text-ink-secondary">
                        {copy(fr, "Benchmark", "Repère")}{" "}
                        {metric.benchmark.toFixed(2)} ·{" "}
                        {metric.feedKg.toFixed(1)} kg{" "}
                        {copy(fr, "feed recorded", "d’aliment enregistré")}
                      </p>
                    </div>
                  ))}
                </div>
                {(overview.data?.alerts ?? []).length ? (
                  <div className="mt-4 space-y-2">
                    {overview.data?.alerts.map((alert, index) => (
                      <p
                        key={`${alert.kind}-${index}`}
                        className="rounded-xl border border-warning/35 bg-warning/10 px-3 py-2 text-sm font-medium text-warning-ink"
                      >
                        {alert.message}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/[.08] px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
                    {overview.data?.assistant}
                  </p>
                )}
              </Panel>
            </div>
          </QueryState>
        </>
      ) : null}
      {dialog?.kind === "recipe" ? (
        <Editor
          title={copy(fr, "New feed recipe", "Nouvelle recette d’aliment")}
          subtitle={copy(
            fr,
            "Feed mill & nutrition",
            "Provenderie & nutrition",
          )}
          fields={recipeFields}
          pending={saveRecipe.isPending}
          error={saveRecipe.error}
          close={() => setDialog(null)}
          save={saveRecipe.mutate}
          fr={fr}
        />
      ) : null}
      {dialog?.kind === "line" ? (
        <Editor
          title={copy(
            fr,
            "Add recipe ingredient",
            "Ajouter un ingrédient à la recette",
          )}
          subtitle={`${text(dialog.recipe.name)} · ${amount(dialog.recipe.baseQuantityKg || 100)} kg`}
          fields={lineFields(dialog.recipe)}
          pending={saveRecipeLine.isPending}
          error={saveRecipeLine.error}
          close={() => setDialog(null)}
          save={(body) =>
            saveRecipeLine.mutate({ ...body, recipeId: text(dialog.recipe.id) })
          }
          fr={fr}
        />
      ) : null}
      {dialog?.kind === "order" ? (
        <Editor
          title={copy(
            fr,
            "New production order",
            "Nouvel ordre de fabrication",
          )}
          subtitle={copy(
            fr,
            "Feed mill & nutrition",
            "Provenderie & nutrition",
          )}
          fields={orderFields}
          pending={saveOrder.isPending}
          error={saveOrder.error}
          close={() => setDialog(null)}
          save={saveOrder.mutate}
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
      hint: copy(
        fr,
        "Leave blank to generate a code automatically from the supplier name. Typed codes are cleaned automatically.",
        "Laissez vide pour générer automatiquement le code depuis le nom du fournisseur. Un code saisi est nettoyé automatiquement.",
      ),
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
  const [requestForLine, setRequestForLine] = useState<string | null>(null);
  const [editingLine, setEditingLine] = useState<Row | null>(null);
  const [requestToReturn, setRequestToReturn] = useState<Row | null>(null);
  const [receiptTransition, setReceiptTransition] = useState<{
    receipt: Row;
    status: ReceiptTransition;
  } | null>(null);
  const [projectFilter, setProjectFilter] = useState("all");
  const create = useMutation({
    mutationFn: ({
      resource,
      body,
    }: {
      resource: OwnerManagementResource;
      body: ManagementBody;
    }) => ownerManagementApi.create(orgSlug, resource, body),
    onSuccess: () => {
      setRequestForLine(null);
      setEditingLine(null);
      setKind(null);
      void client.invalidateQueries({ queryKey: ["operations", orgSlug] });
    },
  });
  const update = useMutation({
    mutationFn: ({
      resource,
      id,
      body,
    }: {
      resource: OwnerManagementResource;
      id: string;
      body: ManagementBody;
    }) => ownerManagementApi.update(orgSlug, resource, id, body),
    onSuccess: () => {
      setRequestForLine(null);
      setEditingLine(null);
      setKind(null);
      void client.invalidateQueries({ queryKey: ["operations", orgSlug] });
    },
  });
  const transitionReceipt = useMutation({
    mutationFn: ({
      receipt,
      status,
      notes,
    }: {
      receipt: Row;
      status: ReceiptTransition;
      notes?: string;
    }) =>
      ownerManagementApi.update(orgSlug, "receipts", receipt.id, {
        status,
        ...(notes ? { notes } : {}),
      }),
    onSuccess: () => {
      setReceiptTransition(null);
      void client.invalidateQueries({ queryKey: ["operations", orgSlug] });
    },
  });
  const returnToDraft = useMutation({
    mutationFn: ({
      request,
      correctionNote,
    }: {
      request: Row;
      correctionNote?: string;
    }) =>
      api.post(
        orgUrl(
          orgSlug,
          `owner-management/purchase-requests/${text(request.id)}/return-to-draft`,
        ),
        { correctionNote },
      ),
    onSuccess: () => {
      setRequestToReturn(null);
      void client.invalidateQueries({ queryKey: ["operations", orgSlug] });
    },
  });
  const [receiptDocumentMessage, setReceiptDocumentMessage] = useState<{
    text: string;
    tone: "success" | "error";
  } | null>(null);
  const createReceiptWithEvidence = useMutation({
    mutationFn: async ({
      body,
      file,
    }: {
      body: ManagementBody;
      file?: File;
    }) => {
      const created = await ownerManagementApi.create<{ record: Row }>(
        orgSlug,
        "receipts",
        body,
      );
      if (!file || !created.record?.id) return { attachmentError: null };
      const form = new FormData();
      form.set("file", file);
      try {
        await api.post(
          orgUrl(orgSlug, `receipt-evidence/${created.record.id}`),
          form,
          { headers: { "Content-Type": "multipart/form-data" } },
        );
        return { attachmentError: null };
      } catch (error) {
        return {
          attachmentError:
            error instanceof Error
              ? error.message
              : copy(
                  fr,
                  "The BR was saved, but the document could not be attached.",
                  "Le BR a été enregistré, mais le document n’a pas pu être joint.",
                ),
        };
      }
    },
    onSuccess: (result) => {
      setRequestForLine(null);
      setEditingLine(null);
      setKind(null);
      setReceiptDocumentMessage(
        result.attachmentError
          ? { text: result.attachmentError, tone: "error" }
          : {
              text: copy(
                fr,
                "Receipt saved. The document is linked to this BR and its project.",
                "Réception enregistrée. Le document est lié à ce BR et à son projet.",
              ),
              tone: "success",
            },
      );
      void client.invalidateQueries({ queryKey: ["operations", orgSlug] });
    },
  });
  const projectOptions = selectOptions(projects.data ?? [], ["name", "code"]);
  const projectLabels = new Map(
    (projects.data ?? []).map((project) => [
      text(project.id),
      [text(project.name), text(project.code)].filter(Boolean).join(" · "),
    ]),
  );
  const projectLabelForRow = (row: Row) => {
    const directLabel = [text(row.projectName), text(row.projectCode)]
      .filter(Boolean)
      .join(" · ");
    if (directLabel) return directLabel;
    const projectId = text(row.projectId);
    return projectId
      ? projectLabels.get(projectId) ||
          copy(fr, "Project unavailable", "Projet indisponible")
      : copy(fr, "Company purchase", "Achat sans projet");
  };
  const matchesProjectFilter = (row: Row) =>
    projectFilter === "all" || text(row.projectId) === projectFilter;
  const visibleRequests = (requests.data ?? []).filter(matchesProjectFilter);
  const visibleOrders = (orders.data ?? []).filter(matchesProjectFilter);
  const visibleReceipts = (receipts.data ?? []).filter(matchesProjectFilter);
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
  const draftRequests = (requests.data ?? []).filter(
    (row) => text(row.status) === "draft",
  );
  // One approved DA creates one live BC. Do not offer requests that already
  // have an active order, otherwise the requested items could be duplicated.
  // A cancelled BC deliberately releases the DA for a replacement order.
  const activeOrderRequestIds = new Set(
    (orders.data ?? [])
      .filter((row) => text(row.status) !== "cancelled")
      .map((row) => text(row.purchaseRequestId))
      .filter(Boolean),
  );
  const approvedRequests = (requests.data ?? []).filter(
    (row) =>
      ["approved", "partially_approved"].includes(text(row.status)) &&
      !activeOrderRequestIds.has(text(row.id)),
  );
  const canReturnPurchaseRequest = (request: Row) => {
    const requestStatus = text(request.status);
    const hasPurchaseOrder = (orders.data ?? []).some(
      (order) => text(order.purchaseRequestId) === text(request.id),
    );
    return (
      ["submitted", "approved", "partially_approved", "rejected"].includes(
        requestStatus,
      ) && !hasPurchaseOrder
    );
  };
  const requestFields: FormField[] = [
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
      options: selectOptions(draftRequests, ["requestNumber"]),
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
      type: "combobox",
      required: true,
      options: procurementUnitOptions(fr),
      hint: copy(
        fr,
        "Choose a common unit or enter another one.",
        "Choisissez une unité courante ou saisissez-en une autre.",
      ),
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
      options: selectOptions(approvedRequests, ["requestNumber"]),
      emptyLabel: copy(
        fr,
        "No purchase requests available",
        "Aucune demande disponible",
      ),
      hint: copy(
        fr,
        "When the order is saved, all approved request items are copied automatically. Add another line only for a real extra item.",
        "À l’enregistrement, tous les articles approuvés de cette demande sont copiés automatiquement. Ajoutez une ligne uniquement pour un véritable article supplémentaire.",
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
      type: "combobox",
      required: true,
      options: procurementUnitOptions(fr),
      hint: copy(
        fr,
        "Choose a common unit or enter another one.",
        "Choisissez une unité courante ou saisissez-en une autre.",
      ),
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
      required: true,
      defaultValue: today(),
    },
    {
      key: "deliveryNoteNumber",
      label: copy(fr, "Delivery note", "Bon de livraison"),
    },
    ...(can(user, "procurement.update")
      ? [
          {
            key: "receiptEvidence",
            label: copy(
              fr,
              "Photo, invoice or delivery document",
              "Photo, facture ou document de livraison",
            ),
            type: "file" as const,
            accept: "application/pdf,image/*,.doc,.docx,.xls,.xlsx,.csv",
            hint: copy(
              fr,
              "Optional. It is attached securely to this BR and its project when you save.",
              "Facultatif. Il sera joint de façon sécurisée à ce BR et à son projet lors de l’enregistrement.",
            ),
          },
        ]
      : []),
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
            title: editingLine
              ? copy(fr, "Edit requested item", "Modifier l’article demandé")
              : copy(
                  fr,
                  "Add requested item",
                  "Ajouter un article à la demande",
                ),
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
  const openKind = (
    next:
      | "request"
      | "request-line"
      | "order"
      | "order-line"
      | "receipt"
      | "receipt-line",
    requestId?: string,
  ) => {
    setEditingLine(null);
    setRequestForLine(requestId ?? null);
    setKind(next);
  };
  const openLineEdit = (line: Row) => {
    setRequestForLine(text(line.purchaseRequestId));
    setEditingLine(line);
    setKind("request-line");
  };

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
          isOwner(user) || can(user, "procurement.create") ? (
            <div className="flex flex-wrap items-center gap-2">
              {isOwner(user) ? (
                <div
                  className="flex flex-wrap items-center gap-1.5"
                  aria-label={copy(
                    fr,
                    "Owner PDF forms",
                    "Formulaires PDF propriétaire",
                  )}
                >
                  <a
                    href={orgApiUrl(
                      orgSlug,
                      "owner-management/procurement/purchase-request-form.pdf",
                    )}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/35 bg-white/10 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/60"
                  >
                    <Download className="size-3.5" />
                    {copy(fr, "Request form", "Formulaire DA")}
                  </a>
                  <a
                    href={orgApiUrl(
                      orgSlug,
                      "owner-management/procurement/purchase-order-form.pdf",
                    )}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/35 bg-white/10 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/60"
                  >
                    <Download className="size-3.5" />
                    {copy(fr, "Purchase-order form", "Formulaire BC")}
                  </a>
                  <a
                    href={orgApiUrl(
                      orgSlug,
                      "owner-management/procurement/receipt-form.pdf",
                    )}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/35 bg-white/10 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/60"
                  >
                    <Download className="size-3.5" />
                    {copy(fr, "Receiving form", "Formulaire BR")}
                  </a>
                </div>
              ) : null}
              {can(user, "procurement.create") ? (
                <Button onClick={() => openKind("request")}>
                  <Plus />
                  {copy(fr, "Purchase request", "Demande d’achat")}
                </Button>
              ) : null}
            </div>
          ) : undefined
        }
      />
      {isOwner(user) ? (
        <section className="rounded-2xl border border-brand/25 bg-surface-1 p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[.12em] text-brand">
                {copy(fr, "Owner tools", "Outils du propriétaire")}
              </p>
              <h2 className="mt-1 text-base font-semibold text-ink">
                {copy(fr, "Printable PDF forms", "Formulaires PDF à remplir")}
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-secondary">
                {copy(
                  fr,
                  "Download a blank form when the request, order or receiving record must be completed manually before entering it in LiteHubs.",
                  "Téléchargez le formulaire vierge lorsque la demande, le bon ou la réception doit être rempli manuellement avant sa saisie dans LiteHubs.",
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={orgApiUrl(
                  orgSlug,
                  "owner-management/procurement/purchase-request-form.pdf",
                )}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-brand/25 bg-brand/5 px-3.5 text-sm font-semibold text-brand transition hover:bg-brand/10"
              >
                <Download className="size-4" />
                {copy(fr, "Purchase request form", "Formulaire DA")}
              </a>
              <a
                href={orgApiUrl(
                  orgSlug,
                  "owner-management/procurement/purchase-order-form.pdf",
                )}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-brand/25 bg-brand/5 px-3.5 text-sm font-semibold text-brand transition hover:bg-brand/10"
              >
                <Download className="size-4" />
                {copy(fr, "Purchase-order form", "Formulaire BC")}
              </a>
              <a
                href={orgApiUrl(
                  orgSlug,
                  "owner-management/procurement/receipt-form.pdf",
                )}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-brand/25 bg-brand/5 px-3.5 text-sm font-semibold text-brand transition hover:bg-brand/10"
              >
                <Download className="size-4" />
                {copy(fr, "Receiving form", "Formulaire BR")}
              </a>
            </div>
          </div>
        </section>
      ) : null}
      <section className="flex flex-col gap-4 rounded-2xl border border-brand/20 bg-surface-1 p-4 shadow-sm sm:flex-row sm:items-end sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand ring-1 ring-brand/15">
            <FolderKanban className="size-5" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-brand">
              {copy(fr, "Procurement scope", "Périmètre des achats")}
            </p>
            <h2 className="mt-1 text-base font-semibold text-ink">
              {copy(fr, "Purchases by project", "Achats par projet")}
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-secondary">
              {copy(
                fr,
                "Select a project to show only its purchase requests, orders, and receipts.",
                "Choisissez un projet pour afficher uniquement ses demandes, bons de commande et réceptions.",
              )}
            </p>
          </div>
        </div>
        <label className="grid w-full gap-1.5 sm:w-80">
          <span className="text-xs font-semibold text-ink-secondary">
            {copy(fr, "Project", "Projet")}
          </span>
          <select
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
            className="h-10 rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
          >
            <option value="all">
              {copy(fr, "All projects", "Tous les projets")}
            </option>
            {projectOptions.map((project) => (
              <option key={project.value} value={project.value}>
                {project.label}
              </option>
            ))}
          </select>
        </label>
      </section>
      <div className="grid gap-4 md:grid-cols-3">
        <Metric
          label={copy(fr, "Purchase requests", "Demandes d’achat")}
          value={String(visibleRequests.length)}
        />
        <Metric
          label={copy(fr, "Purchase orders", "Bons de commande")}
          value={String(visibleOrders.length)}
        />
        <Metric
          label={copy(fr, "Receipts", "Réceptions")}
          value={String(visibleReceipts.length)}
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <ProcurementRecordsPanel
          title={copy(fr, "Purchase requests", "Demandes d’achat")}
          description={copy(
            fr,
            "Start with a business need, add its articles, then submit it for approval.",
            "Créez le besoin, ajoutez ses articles, puis soumettez-le à approbation.",
          )}
          type="request"
          rows={visibleRequests}
          relatedRows={requestLines.data ?? []}
          relationKey="purchaseRequestId"
          relatedLabel={copy(fr, "item(s)", "article(s)")}
          empty={copy(fr, "No purchase requests", "Aucune demande d’achat")}
          createLabel={copy(fr, "New request", "Nouvelle demande")}
          onCreate={
            can(user, "procurement.create")
              ? () => openKind("request")
              : undefined
          }
          onAddItem={
            can(user, "procurement.create")
              ? (request) => openKind("request-line", request.id)
              : undefined
          }
          onEditItem={
            can(user, "procurement.update") ? openLineEdit : undefined
          }
          onReturnToDraft={
            isOwner(user) && can(user, "procurement.update")
              ? setRequestToReturn
              : undefined
          }
          canReturnToDraft={canReturnPurchaseRequest}
          projectLabelForRow={projectLabelForRow}
          orgSlug={orgSlug}
          canDownload={isOwner(user)}
          fr={fr}
        />
        <ProcurementRecordsPanel
          title={copy(fr, "Purchase orders", "Bons de commande")}
          description={copy(
            fr,
            "Create a supplier order only after a purchase request is approved.",
            "Créez une commande fournisseur seulement après approbation d’une demande.",
          )}
          type="order"
          rows={visibleOrders}
          relatedRows={orderLines.data ?? []}
          relationKey="purchaseOrderId"
          relatedLabel={copy(fr, "line(s)", "ligne(s)")}
          empty={copy(fr, "No purchase orders", "Aucun bon de commande")}
          createLabel={copy(fr, "New order", "Nouveau bon")}
          onCreate={
            can(user, "procurement.create")
              ? () => openKind("order")
              : undefined
          }
          projectLabelForRow={projectLabelForRow}
          orgSlug={orgSlug}
          canDownload={isOwner(user)}
          fr={fr}
        />
        <ProcurementRecordsPanel
          title={copy(fr, "Receiving", "Réceptions")}
          description={copy(
            fr,
            "Prepare the actual quantities, confirm the delivery, then verify it. Supplier payment stays separate from the goods receipt.",
            "Préparez les quantités réellement livrées, confirmez la livraison, puis vérifiez-la. Le paiement fournisseur reste distinct du bon de réception.",
          )}
          type="receipt"
          rows={visibleReceipts}
          relatedRows={receiptLines.data ?? []}
          relationKey="receiptId"
          relatedLabel={copy(fr, "line(s)", "ligne(s)")}
          empty={copy(fr, "No receipts", "Aucune réception")}
          createLabel={copy(fr, "New receiving", "Nouvelle réception")}
          onCreate={
            can(user, "procurement.create")
              ? () => openKind("receipt")
              : undefined
          }
          onAddItem={
            can(user, "procurement.create")
              ? (receipt) => openKind("receipt-line", receipt.id)
              : undefined
          }
          projectLabelForRow={projectLabelForRow}
          onReceiptStatusChange={
            can(user, "procurement.update")
              ? (receipt, status) => setReceiptTransition({ receipt, status })
              : undefined
          }
          orgSlug={orgSlug}
          canDownload={isOwner(user)}
          fr={fr}
        />
      </div>
      {receiptDocumentMessage ? (
        <p
          className={
            receiptDocumentMessage.tone === "error"
              ? "rounded-xl border border-critical/30 bg-critical/10 px-4 py-3 text-sm text-critical"
              : "rounded-xl border border-good/30 bg-good/10 px-4 py-3 text-sm text-good"
          }
          role={receiptDocumentMessage.tone === "error" ? "alert" : "status"}
        >
          {receiptDocumentMessage.text}
        </p>
      ) : null}
      {receiptTransition ? (
        <ReceiptStatusDialog
          receipt={receiptTransition.receipt}
          nextStatus={receiptTransition.status}
          pending={transitionReceipt.isPending}
          error={transitionReceipt.error}
          onClose={() => setReceiptTransition(null)}
          onConfirm={(notes) =>
            transitionReceipt.mutate({
              receipt: receiptTransition.receipt,
              status: receiptTransition.status,
              notes,
            })
          }
          fr={fr}
        />
      ) : null}
      {requestToReturn ? (
        <ReturnPurchaseRequestDialog
          request={requestToReturn}
          pending={returnToDraft.isPending}
          error={returnToDraft.error}
          onClose={() => setRequestToReturn(null)}
          onConfirm={(correctionNote) =>
            returnToDraft.mutate({ request: requestToReturn, correctionNote })
          }
          fr={fr}
        />
      ) : null}
      {spec ? (
        <Editor
          title={spec.title}
          subtitle={copy(fr, "Procurement", "Achats")}
          row={editingLine ?? undefined}
          fields={spec.fields}
          defaults={
            kind === "request" && projectFilter !== "all"
              ? { projectId: projectFilter }
              : kind === "request-line" && requestForLine
                ? { purchaseRequestId: requestForLine }
                : kind === "receipt-line" && requestForLine
                  ? { receiptId: requestForLine }
                  : undefined
          }
          pending={
            create.isPending ||
            update.isPending ||
            createReceiptWithEvidence.isPending
          }
          error={
            createReceiptWithEvidence.error ?? create.error ?? update.error
          }
          close={() => {
            setRequestForLine(null);
            setEditingLine(null);
            setKind(null);
          }}
          save={(body, files) => {
            if (kind === "receipt") {
              body.projectId =
                (orders.data ?? []).find(
                  (order) => text(order.id) === text(body.purchaseOrderId),
                )?.projectId ?? null;
              createReceiptWithEvidence.mutate({
                body,
                file: files?.receiptEvidence,
              });
              return;
            }
            if (kind === "request-line" && editingLine) {
              update.mutate({
                resource: "purchase-request-lines",
                id: editingLine.id,
                body,
              });
              return;
            }
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
  const queryClient = useQueryClient();
  const assets = useRows(orgSlug, "assets", can(user, "equipment.read"));
  const equipmentCategories = useQuery({
    queryKey: ["operations", orgSlug, "equipment-categories"],
    queryFn: () =>
      ownerManagementApi.equipmentCategories<{
        categories: Row[];
        categoryStoreReady: boolean;
      }>(orgSlug),
    enabled: can(user, "equipment.read"),
  });
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
  const [assetSearch, setAssetSearch] = useState("");
  const [assetDetail, setAssetDetail] = useState<Row | null>(null);
  const [assetEditSignal, setAssetEditSignal] = useState<{
    requestId: number;
    row: Row;
  } | null>(null);
  const [assetProjectFilter, setAssetProjectFilter] = useState("all");
  const [assetProvinceFilter, setAssetProvinceFilter] = useState("all");
  const [assetSiteFilter, setAssetSiteFilter] = useState("all");
  const [assetStatusFilter, setAssetStatusFilter] = useState("all");
  const [assetCategoryFilter, setAssetCategoryFilter] = useState("all");
  const [addingCategory, setAddingCategory] = useState(false);
  const categoryMutation = useMutation({
    mutationFn: (body: ManagementBody) =>
      ownerManagementApi.createEquipmentCategory(orgSlug, {
        name: text(body.name),
        description: text(body.description) || null,
      }),
    onSuccess: () => {
      setAddingCategory(false);
      void queryClient.invalidateQueries({
        queryKey: ["operations", orgSlug, "equipment-categories"],
      });
    },
  });
  const projectsById = new Map(
    (projects.data ?? []).map((project) => [text(project.id), project]),
  );
  const assetQuery = assetSearch.trim().toLocaleLowerCase();
  const filteredAssets = (assets.data ?? []).filter((asset) => {
    const project = projectsById.get(text(asset.projectId));
    const assetProvinceId = text(asset.provinceId) || text(project?.provinceId);
    const assetSiteId = text(asset.siteId) || text(project?.siteId);
    const matchesSearch = !assetQuery
      ? true
      : [
          asset.name,
          asset.assetNumber,
          asset.category,
          asset.brand,
          asset.model,
          asset.serialNumber,
          asset.currentLocation,
          asset.projectName,
          asset.siteName,
          asset.provinceName,
          project?.name,
          project?.code,
        ]
          .map((value) => text(value).toLocaleLowerCase())
          .join(" ")
          .includes(assetQuery);
    return (
      matchesSearch &&
      (assetProjectFilter === "all"
        ? true
        : assetProjectFilter === "none"
          ? !text(asset.projectId)
          : text(asset.projectId) === assetProjectFilter) &&
      (assetProvinceFilter === "all" ||
        assetProvinceId === assetProvinceFilter) &&
      (assetSiteFilter === "all" || assetSiteId === assetSiteFilter) &&
      (assetStatusFilter === "all" ||
        text(asset.status) === assetStatusFilter) &&
      (assetCategoryFilter === "all" ||
        text(asset.category) === assetCategoryFilter)
    );
  });
  const assetCategoryOptions = Array.from(
    new Map(
      [
        ...(equipmentCategories.data?.categories ?? []),
        ...(assets.data ?? []).map((asset) => ({ name: text(asset.category) })),
      ]
        .map((category) => text(category.name))
        .filter(Boolean)
        .map((name) => [
          name.toLocaleLowerCase(),
          { value: name, label: name },
        ]),
    ).values(),
  ).sort((left, right) => left.label.localeCompare(right.label));
  const hasAssetFilters = Boolean(
    assetSearch ||
    assetProjectFilter !== "all" ||
    assetProvinceFilter !== "all" ||
    assetSiteFilter !== "all" ||
    assetStatusFilter !== "all" ||
    assetCategoryFilter !== "all",
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
      type: "select",
      required: true,
      options: assetCategoryOptions,
      emptyLabel: copy(
        fr,
        "Create an equipment category first",
        "Créez d’abord une catégorie d’équipement",
      ),
      hint: copy(
        fr,
        "Categories are managed at the top of this register.",
        "Les catégories se gèrent en haut de ce registre.",
      ),
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
    {
      key: "photo",
      label: copy(fr, "Equipment photo", "Photo de l’équipement"),
      type: "file",
      accept: "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif",
      hint: copy(
        fr,
        "Optional. A private thumbnail will appear in the equipment register.",
        "Facultative. Une miniature privée apparaîtra dans le registre des équipements.",
      ),
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
      <section className="rounded-2xl border border-brand/20 bg-surface-1 p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-brand">
              {copy(fr, "Equipment scope", "Périmètre des équipements")}
            </p>
            <h2 className="mt-1 text-base font-semibold text-ink">
              {copy(
                fr,
                "Find equipment by location or project",
                "Retrouvez l’équipement par lieu ou projet",
              )}
            </h2>
            <p className="mt-1 text-sm text-ink-secondary">
              {hasAssetFilters
                ? copy(
                    fr,
                    `${filteredAssets.length} matching equipment record(s)`,
                    `${filteredAssets.length} équipement(s) correspondant(s)`,
                  )
                : copy(
                    fr,
                    `${filteredAssets.length} equipment record(s)`,
                    `${filteredAssets.length} équipement(s)`,
                  )}
            </p>
          </div>
          {hasAssetFilters ? (
            <button
              type="button"
              onClick={() => {
                setAssetSearch("");
                setAssetProjectFilter("all");
                setAssetProvinceFilter("all");
                setAssetSiteFilter("all");
                setAssetStatusFilter("all");
                setAssetCategoryFilter("all");
              }}
              className="text-xs font-semibold text-brand hover:underline"
            >
              {copy(fr, "Clear filters", "Effacer les filtres")}
            </button>
          ) : null}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Input
            value={assetSearch}
            onChange={(event) => setAssetSearch(event.target.value)}
            placeholder={copy(
              fr,
              "Search equipment…",
              "Rechercher un équipement…",
            )}
            className="xl:col-span-1"
          />
          <select
            value={assetCategoryFilter}
            onChange={(event) => setAssetCategoryFilter(event.target.value)}
            className="h-9 rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
            aria-label={copy(fr, "Filter by category", "Filtrer par catégorie")}
          >
            <option value="all">
              {copy(fr, "All categories", "Toutes les catégories")}
            </option>
            {assetCategoryOptions.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
          <select
            value={assetProjectFilter}
            onChange={(event) => setAssetProjectFilter(event.target.value)}
            className="h-9 rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
            aria-label={copy(fr, "Filter by project", "Filtrer par projet")}
          >
            <option value="all">
              {copy(fr, "All projects", "Tous les projets")}
            </option>
            <option value="none">
              {copy(fr, "No project", "Sans projet")}
            </option>
            {selectOptions(projects.data ?? [], ["name", "code"]).map(
              (project) => (
                <option key={project.value} value={project.value}>
                  {project.label}
                </option>
              ),
            )}
          </select>
          <select
            value={assetProvinceFilter}
            onChange={(event) => setAssetProvinceFilter(event.target.value)}
            className="h-9 rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
            aria-label={copy(fr, "Filter by province", "Filtrer par province")}
          >
            <option value="all">
              {copy(fr, "All provinces", "Toutes les provinces")}
            </option>
            {selectOptions(refs.provinces.data ?? [], ["name", "code"]).map(
              (province) => (
                <option key={province.value} value={province.value}>
                  {province.label}
                </option>
              ),
            )}
          </select>
          <select
            value={assetSiteFilter}
            onChange={(event) => setAssetSiteFilter(event.target.value)}
            className="h-9 rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
            aria-label={copy(fr, "Filter by site", "Filtrer par site")}
          >
            <option value="all">
              {copy(fr, "All sites", "Tous les sites")}
            </option>
            {selectOptions(refs.sites.data ?? [], ["name", "code"]).map(
              (site) => (
                <option key={site.value} value={site.value}>
                  {site.label}
                </option>
              ),
            )}
          </select>
          <select
            value={assetStatusFilter}
            onChange={(event) => setAssetStatusFilter(event.target.value)}
            className="h-9 rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
            aria-label={copy(fr, "Filter by status", "Filtrer par statut")}
          >
            <option value="all">
              {copy(fr, "All statuses", "Tous les statuts")}
            </option>
            {[
              "available",
              "assigned",
              "in_use",
              "under_maintenance",
              "out_of_service",
              "damaged",
              "retired",
              "sold",
              "lost",
            ].map((status) => (
              <option key={status} value={status}>
                {nice(status)}
              </option>
            ))}
          </select>
        </div>
      </section>
      <QueryState query={equipmentCategories}>
        <Panel
          title={copy(fr, "Equipment categories", "Catégories d’équipement")}
          description={copy(
            fr,
            "Create the company categories used when registering and finding equipment.",
            "Créez les catégories de l’entreprise utilisées pour enregistrer et retrouver les équipements.",
          )}
          action={
            equipmentCategories.data?.categoryStoreReady !== false &&
            isOwner(user) &&
            can(user, "equipment.create") ? (
              <Button size="sm" onClick={() => setAddingCategory(true)}>
                <Plus />
                {copy(fr, "Add category", "Ajouter une catégorie")}
              </Button>
            ) : undefined
          }
        >
          {equipmentCategories.data?.categories.length ? (
            <div className="flex flex-wrap gap-2">
              {equipmentCategories.data.categories.map((category) => {
                const categoryName = text(category.name);
                const selected = assetCategoryFilter === categoryName;
                return (
                  <button
                    key={category.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setAssetCategoryFilter(categoryName);
                      requestAnimationFrame(() =>
                        document
                          .getElementById("equipment-register")
                          ?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          }),
                      );
                    }}
                    className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${selected ? "border-brand bg-brand text-white shadow-sm" : "border-border bg-surface-2 text-ink hover:border-brand/45 hover:bg-brand-subtle"}`}
                  >
                    {categoryName}
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title={
                equipmentCategories.data?.categoryStoreReady === false
                  ? copy(
                      fr,
                      "Category update pending",
                      "Mise à jour des catégories en attente",
                    )
                  : copy(
                      fr,
                      "No category yet",
                      "Aucune catégorie pour le moment",
                    )
              }
              description={
                equipmentCategories.data?.categoryStoreReady === false
                  ? copy(
                      fr,
                      "Existing equipment remains available. Category creation will be available when the company update is applied.",
                      "Les équipements existants restent disponibles. La création de catégories sera disponible lorsque la mise à jour de l’entreprise sera appliquée.",
                    )
                  : copy(
                      fr,
                      "Create your first category, such as Engines, Machines, Pumps, or Vehicles.",
                      "Créez votre première catégorie : Engins, Machines, Pompes ou Véhicules.",
                    )
              }
              action={
                equipmentCategories.data?.categoryStoreReady !== false &&
                isOwner(user) &&
                can(user, "equipment.create")
                  ? {
                      label: copy(fr, "Add category", "Ajouter une catégorie"),
                      onClick: () => setAddingCategory(true),
                    }
                  : undefined
              }
            />
          )}
        </Panel>
      </QueryState>
      <div className="grid gap-5 xl:grid-cols-2">
        <div id="equipment-register">
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
              rows={filteredAssets}
              rowsVariant="cards"
              renderCard={(asset, open) => (
                <EquipmentAssetCard
                  orgSlug={orgSlug}
                  asset={asset}
                  fields={["category", "status", "condition", "purchaseDate"]}
                  open={open}
                  fr={fr}
                />
              )}
              openDetail={(asset) => setAssetDetail(asset)}
              editSignal={assetEditSignal}
              afterSave={async (asset, files) => {
                const photo = files?.photo;
                if (!photo) return;
                const current = await get<{ images: Row[] }>(
                  orgUrl(orgSlug, `images/owner-management/assets/${asset.id}`),
                );
                const form = new FormData();
                form.set("file", photo);
                form.set(
                  "title",
                  `${text(asset.name) || text(asset.assetNumber) || "Equipment"} · ${copy(fr, "photo", "photo")}`,
                );
                form.set(
                  "altText",
                  text(asset.name) ||
                    text(asset.assetNumber) ||
                    copy(fr, "Equipment photo", "Photo de l’équipement"),
                );
                form.set("imageType", "equipment_photo");
                await api.post(
                  orgUrl(orgSlug, `images/owner-management/assets/${asset.id}`),
                  form,
                  { headers: { "Content-Type": "multipart/form-data" } },
                );
                await Promise.all(
                  current.images
                    .filter(
                      (image) =>
                        text(image.documentType) === "equipment_photo" ||
                        text(image.title).endsWith(" · photo"),
                    )
                    .map((image) =>
                      api.delete(orgUrl(orgSlug, `images/${image.id}`)),
                    ),
                );
                await queryClient.invalidateQueries({
                  queryKey: ["equipment-images", orgSlug, asset.id],
                });
              }}
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
        </div>
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
      {assetDetail ? (
        <EquipmentAssetDetailDialog
          orgSlug={orgSlug}
          asset={assetDetail}
          fr={fr}
          projects={projects.data ?? []}
          suppliers={suppliers.data ?? []}
          sites={refs.sites.data ?? []}
          provinces={refs.provinces.data ?? []}
          employees={refs.employees.data ?? []}
          onClose={() => setAssetDetail(null)}
          onEdit={
            can(user, "equipment.update")
              ? () => {
                  setAssetEditSignal({
                    requestId: Date.now(),
                    row: assetDetail,
                  });
                  setAssetDetail(null);
                }
              : undefined
          }
        />
      ) : null}
      {addingCategory ? (
        <Editor
          title={copy(
            fr,
            "Add equipment category",
            "Ajouter une catégorie d’équipement",
          )}
          subtitle={copy(fr, "Equipment categories", "Catégories d’équipement")}
          fields={[
            {
              key: "name",
              label: copy(fr, "Category name", "Nom de la catégorie"),
              required: true,
            },
            {
              key: "description",
              label: copy(fr, "Description", "Description"),
              type: "textarea",
              hint: copy(
                fr,
                "Optional guidance for people registering equipment.",
                "Indication facultative pour les personnes qui enregistrent les équipements.",
              ),
            },
          ]}
          pending={categoryMutation.isPending}
          error={categoryMutation.error}
          close={() => setAddingCategory(false)}
          save={(body) => categoryMutation.mutate(body)}
          fr={fr}
        />
      ) : null}
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
      key: "intervalMeter",
      label: copy(fr, "Interval (meter)", "Intervalle (compteur)"),
      type: "number",
      step: "0.01",
      hint: copy(
        fr,
        "Kilometres or engine-hours, according to the asset.",
        "Kilomètres ou heures moteur, selon l’actif.",
      ),
    },
    {
      key: "nextDueDate",
      label: copy(fr, "Next due date", "Prochaine échéance"),
      type: "date",
    },
    {
      key: "nextDueMeter",
      label: copy(fr, "Next due meter", "Prochain compteur"),
      type: "number",
      step: "0.01",
    },
    {
      key: "serviceCategory",
      label: copy(fr, "Service category", "Catégorie de service"),
      type: "select",
      options: [
        "oil_change",
        "filters",
        "brakes",
        "tyres",
        "cooling",
        "safety_inspection",
        "manufacturer_service",
        "other",
      ].map((value) => ({ value, label: nice(value) })),
    },
    {
      key: "warningWindowDays",
      label: copy(fr, "Alert before (days)", "Alerter avant (jours)"),
      type: "number",
      defaultValue: 7,
    },
    {
      key: "warningWindowMeter",
      label: copy(fr, "Alert before (meter)", "Alerter avant (compteur)"),
      type: "number",
      step: "0.01",
    },
    {
      key: "blocksDispatchWhenDue",
      label: copy(fr, "Block departure when due", "Bloquer la sortie quand dû"),
      type: "checkbox",
      defaultValue: false,
      hint: copy(
        fr,
        "Use for safety-critical oil, brake, tyre, or manufacturer service.",
        "À utiliser pour l’huile, les freins, pneus ou service constructeur critique.",
      ),
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
              "nextDueMeter",
              "blocksDispatchWhenDue",
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
  feedTab,
}: {
  orgSlug: string;
  area: OperationsAreaKind;
  feedTab?: "raw-materials" | "recipes" | "production-orders" | "planning";
}) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  if (area === "tasks") return <TasksWorkspace orgSlug={orgSlug} fr={fr} />;
  if (area === "inventory")
    return <InventoryWorkspace orgSlug={orgSlug} fr={fr} />;
  if (area === "feed-mill")
    return <FeedMillWorkspace orgSlug={orgSlug} fr={fr} tab={feedTab} />;
  if (area === "suppliers")
    return <SuppliersWorkspace orgSlug={orgSlug} fr={fr} />;
  if (area === "procurement")
    return <ProcurementWorkspace orgSlug={orgSlug} fr={fr} />;
  if (area === "equipment")
    return <EquipmentWorkspace orgSlug={orgSlug} fr={fr} />;
  return <MaintenanceWorkspace orgSlug={orgSlug} fr={fr} />;
}
