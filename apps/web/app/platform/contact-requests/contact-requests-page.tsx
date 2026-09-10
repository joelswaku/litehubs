"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ClipboardList,
  Clock3,
  Mail,
  MessageSquareText,
  Search,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState, SkeletonCard } from "@/components/ui/states";
import { ApiError, get, patch } from "@/lib/api";
import { canPlatform } from "@/lib/permissions";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";

type Status = "new" | "in_progress" | "resolved" | "closed";
type ContactRequestCopy = {
  new: string;
  in_progress: string;
  resolved: string;
  closed: string;
  general: string;
  access: string;
  technical: string;
  billing: string;
  demo: string;
  other: string;
  received: string;
  reply: string;
  internalNote: string;
  save: string;
  saving: string;
  handledBy: string;
};
type ContactRequest = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  companyName: string | null;
  category: string;
  subject: string;
  message: string;
  preferredLanguage: "fr" | "en";
  status: Status;
  adminNote: string | null;
  handledBy: { id: string; fullName: string } | null;
  handledAt: string | null;
  createdAt: string;
};

const copy = {
  fr: {
    eyebrow: "ASSISTANCE LITEHUBS",
    title: "Demandes de contact",
    description:
      "Les messages envoyés depuis la page Contact. Traitez-les ici sans accéder aux données d’une entreprise cliente.",
    search: "Rechercher un nom, un e-mail ou un message…",
    all: "Toutes",
    new: "Nouvelles",
    in_progress: "En cours",
    resolved: "Résolues",
    closed: "Fermées",
    noRequests: "Aucune demande ne correspond à ce filtre.",
    loadingError: "Impossible de charger les demandes de contact.",
    retry: "Réessayer",
    received: "Reçue",
    reply: "Répondre à",
    internalNote: "Note interne",
    save: "Enregistrer le suivi",
    saving: "Enregistrement…",
    handledBy: "Traitée par",
    filter: "Filtrer",
    access: "Accès",
    technical: "Technique",
    billing: "Facturation",
    demo: "Démonstration",
    general: "Général",
    other: "Autre",
    permission:
      "Votre rôle ne permet pas de consulter les demandes de contact.",
  },
  en: {
    eyebrow: "LITEHUBS SUPPORT",
    title: "Contact requests",
    description:
      "Messages sent from the Contact page. Handle them here without accessing a customer organization’s data.",
    search: "Search a name, email, or message…",
    all: "All",
    new: "New",
    in_progress: "In progress",
    resolved: "Resolved",
    closed: "Closed",
    noRequests: "No contact requests match this filter.",
    loadingError: "Could not load contact requests.",
    retry: "Try again",
    received: "Received",
    reply: "Reply to",
    internalNote: "Internal note",
    save: "Save handling",
    saving: "Saving…",
    handledBy: "Handled by",
    filter: "Filter",
    access: "Access",
    technical: "Technical",
    billing: "Billing",
    demo: "Demonstration",
    general: "General",
    other: "Other",
    permission: "Your role cannot view contact requests.",
  },
} as const;

export function ContactRequestsPage() {
  const { locale } = useLanguage();
  const text = copy[locale];
  const user = useSessionUser();
  const permitted = canPlatform(user, "platform.contact_requests.read");
  const canUpdate = canPlatform(user, "platform.contact_requests.update");
  const [status, setStatus] = useState<Status | "all">("new");
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["platform-contact-requests", status, search],
    queryFn: () =>
      get<{ requests: ContactRequest[]; total: number }>(
        `/platform/contact-requests?limit=100${status === "all" ? "" : `&status=${status}`}${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ""}`,
      ),
    enabled: permitted,
  });

  const counts = useMemo(() => {
    const requests = query.data?.requests ?? [];
    return {
      all: query.data?.total ?? 0,
      new: requests.filter((item) => item.status === "new").length,
      in_progress: requests.filter((item) => item.status === "in_progress")
        .length,
      resolved: requests.filter((item) => item.status === "resolved").length,
      closed: requests.filter((item) => item.status === "closed").length,
    };
  }, [query.data]);

  if (!permitted) {
    return (
      <main className="grid min-h-[60dvh] place-items-center p-6">
        <div className="max-w-md text-center">
          <ClipboardList
            className="mx-auto size-10 text-ink-muted"
            aria-hidden
          />
          <h1 className="mt-4 text-xl font-semibold">{text.title}</h1>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">
            {text.permission}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="relative isolate overflow-hidden rounded-2xl border border-border bg-[linear-gradient(125deg,#103d79_0%,#1d5eaa_52%,#3989e5_100%)] px-5 py-6 text-white shadow-[0_20px_55px_-32px_rgba(13,54,107,0.8)] sm:px-7 sm:py-8">
        <div
          className="pointer-events-none absolute -right-16 -top-20 size-72 rounded-full border border-white/10 bg-white/5"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-2xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide text-blue-50">
              <MessageSquareText className="size-3.5" aria-hidden />
              {text.eyebrow}
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
              {text.title}
            </h1>
            <p className="mt-3 text-sm leading-6 text-blue-50/90 sm:text-base">
              {text.description}
            </p>
          </div>
          <div className="rounded-xl border border-white/15 bg-slate-950/15 px-5 py-4 backdrop-blur">
            <p className="text-xs font-medium text-blue-100">{text.new}</p>
            <p className="mt-1 text-3xl font-semibold tabular">
              {query.isPending ? "—" : counts.new}
            </p>
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-border bg-surface-1 shadow-[0_12px_32px_-28px_rgba(11,11,11,0.55)]">
        <div className="flex flex-col gap-4 border-b border-border p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2" aria-label={text.filter}>
            {(["all", "new", "in_progress", "resolved", "closed"] as const).map(
              (item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setStatus(item)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${status === item ? "bg-brand text-brand-ink" : "bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink"}`}
                >
                  {text[item]}{" "}
                  <span className="ml-1 tabular opacity-80">
                    {status === item || item === "all" ? counts[item] : ""}
                  </span>
                </button>
              ),
            )}
          </div>
          <label className="relative block w-full lg:w-80">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={text.search}
              className="h-10 pl-9"
            />
          </label>
        </div>
        {query.isPending ? (
          <div className="p-5">
            <SkeletonCard rows={6} />
          </div>
        ) : query.isError ? (
          <ErrorState
            description={text.loadingError}
            onRetry={() => query.refetch()}
          />
        ) : query.data?.requests.length ? (
          <div className="divide-y divide-border">
            {query.data.requests.map((request) => (
              <ContactRequestRow
                key={request.id}
                request={request}
                canUpdate={canUpdate}
                text={text}
                locale={locale}
              />
            ))}
          </div>
        ) : (
          <div className="px-6 py-16 text-center">
            <MessageSquareText
              className="mx-auto size-9 text-ink-muted"
              aria-hidden
            />
            <p className="mt-3 text-sm text-ink-secondary">{text.noRequests}</p>
          </div>
        )}
      </section>
    </main>
  );
}

function ContactRequestRow({
  request,
  canUpdate,
  text,
  locale,
}: {
  request: ContactRequest;
  canUpdate: boolean;
  text: ContactRequestCopy;
  locale: "fr" | "en";
}) {
  const queryClient = useQueryClient();
  const [nextStatus, setNextStatus] = useState<Status>(request.status);
  const [note, setNote] = useState(request.adminNote ?? "");
  const update = useMutation({
    mutationFn: () =>
      patch<{ request: ContactRequest }>(
        `/platform/contact-requests/${request.id}`,
        { status: nextStatus, adminNote: note.trim() || null },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["platform-contact-requests"],
      }),
  });
  const message =
    update.error instanceof ApiError
      ? update.error.message
      : update.error
        ? "Unable to save."
        : null;
  const date = new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(request.createdAt));
  return (
    <article
      className={`p-4 sm:p-5 ${request.status === "new" ? "bg-brand/[0.035]" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-ink">
              {request.subject}
            </h2>
            <StatusBadge status={request.status} text={text} />
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            {text.received} {date} · {categoryLabel(request.category, text)}
          </p>
        </div>
        {request.companyName ? (
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-secondary">
            {request.companyName}
          </span>
        ) : null}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.72fr)]">
        <div>
          <p className="whitespace-pre-wrap text-sm leading-6 text-ink-secondary">
            {request.message}
          </p>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink-secondary">
            <a
              href={`mailto:${request.email}`}
              className="inline-flex items-center gap-1.5 font-semibold text-brand hover:underline"
            >
              <Mail className="size-3.5" aria-hidden />
              {text.reply}: {request.email}
            </a>
            <span className="inline-flex items-center gap-1.5">
              <UserRound className="size-3.5" aria-hidden />
              {request.fullName}
              {request.phone ? ` · ${request.phone}` : ""}
            </span>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface-2/65 p-3.5">
          <label className="block text-xs font-semibold text-ink-secondary">
            {text.internalNote}
          </label>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={!canUpdate}
            maxLength={4000}
            rows={3}
            className="mt-1.5 w-full resize-y rounded-md border border-border-strong bg-surface-1 px-2.5 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:cursor-not-allowed disabled:opacity-70"
          />
          <div className="mt-3 flex items-center gap-2">
            <select
              value={nextStatus}
              disabled={!canUpdate}
              onChange={(event) => setNextStatus(event.target.value as Status)}
              className="h-9 flex-1 rounded-md border border-border-strong bg-surface-1 px-2 text-sm text-ink disabled:cursor-not-allowed disabled:opacity-70"
            >
              {(["new", "in_progress", "resolved", "closed"] as const).map(
                (item) => (
                  <option key={item} value={item}>
                    {text[item]}
                  </option>
                ),
              )}
            </select>
            {canUpdate ? (
              <Button
                size="sm"
                onClick={() => update.mutate()}
                loading={update.isPending}
              >
                {update.isPending ? text.saving : text.save}
              </Button>
            ) : null}
          </div>
          {request.handledBy ? (
            <p className="mt-2 text-[11px] text-ink-muted">
              {text.handledBy}: {request.handledBy.fullName}
            </p>
          ) : null}
          {message ? (
            <p className="mt-2 text-xs text-critical" role="alert">
              {message}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function StatusBadge({
  status,
  text,
}: {
  status: Status;
  text: ContactRequestCopy;
}) {
  const variant =
    status === "new"
      ? "critical"
      : status === "in_progress"
        ? "warning"
        : status === "resolved"
          ? "good"
          : "neutral";
  return <Badge variant={variant}>{text[status]}</Badge>;
}
function categoryLabel(category: string, text: ContactRequestCopy) {
  return text[category as keyof typeof text] ?? text.other;
}
