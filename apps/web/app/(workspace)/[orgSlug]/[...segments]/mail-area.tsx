"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowLeft,
  BriefcaseBusiness,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  FileDown,
  Forward,
  Inbox,
  Mail,
  MailOpen,
  Paperclip,
  PenSquare,
  RefreshCw,
  Reply,
  ReplyAll,
  Search,
  Send,
  Settings2,
  ShieldAlert,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/ui/states";
import { api, get, orgUrl, patch, post, put } from "@/lib/api";
import { useLanguage } from "@/providers/language-provider";
import { AiInstructionsDialog } from "@/components/ai/ai-instructions-dialog";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Mailbox = {
  id: string;
  emailAddress: string;
  displayName: string | null;
  status: "active" | "error" | "disabled";
  lastError: string | null;
  lastCheckedAt: string | null;
  unseenCount: number;
  signature: string | null;
  aliases?: string[];
  canSend: boolean;
  username?: string;
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  memberIds?: string[];
};
type MailboxesResponse = {
  aiEnabled?: boolean;
  canManage: boolean;
  canSend: boolean;
  mailboxes: Mailbox[];
  members: { id: string; name: string; email: string }[];
};
type Folder = { path: string; name: string; kind: string | null; total: number; unseen: number };
type Address = { name: string; address: string };
type MessageSummary = {
  uid: number;
  subject: string;
  from: Address[];
  to: Address[];
  date: string | null;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  hasAttachments: boolean;
};
type MessageDetail = {
  uid: number;
  folder: string;
  subject: string;
  from: Address[];
  to: Address[];
  cc: Address[];
  replyTo: Address[];
  date: string | null;
  flagged: boolean;
  html: string;
  text: string;
  attachments: { index: number; fileName: string; mimeType: string; size: number }[];
  candidates: { id: string; fullName: string; status: string; email: string; jobTitle: string }[];
  receivedOn?: string | null;
};
type ComposeDraft = {
  fromAddress?: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  replyToUid?: number;
  replyFolder?: string;
  forwardAttachments?: boolean;
  aiAuto?: boolean;
  title: string;
};

const tr = (fr: boolean, french: string, english: string) => (fr ? french : english);

const FOLDER_LABELS: Record<string, [string, string]> = {
  "\\Inbox": ["Boîte de réception", "Inbox"],
  "\\Sent": ["Envoyés", "Sent"],
  "\\Drafts": ["Brouillons", "Drafts"],
  "\\Archive": ["Archives", "Archive"],
  "\\Junk": ["Indésirables", "Junk"],
  "\\Trash": ["Corbeille", "Trash"],
  "\\Flagged": ["Suivis", "Flagged"],
};
const folderLabel = (folder: Folder, fr: boolean) => {
  const known = folder.kind ? FOLDER_LABELS[folder.kind] : undefined;
  return known ? (fr ? known[0] : known[1]) : folder.name;
};
const folderIcon = (kind: string | null) =>
  kind === "\\Sent" ? Send : kind === "\\Trash" ? Trash2 : kind === "\\Archive" ? Archive : kind === "\\Junk" ? ShieldAlert : kind === "\\Flagged" ? Star : Inbox;

const person = (list: Address[]) => list.map((item) => item.name || item.address).join(", ");
const addresses = (list: Address[]) => list.map((item) => item.address).filter(Boolean).join(", ");

function shortDate(value: string | null, fr: boolean) {
  if (!value) return "";
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString(fr ? "fr-FR" : "en-GB", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(fr ? "fr-FR" : "en-GB", {
        day: "numeric",
        month: "short",
        ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
      });
}
const fullDate = (value: string | null, fr: boolean) =>
  value ? new Date(value).toLocaleString(fr ? "fr-FR" : "en-GB", { dateStyle: "full", timeStyle: "short" }) : "";
const sizeText = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`;

function errorMessage(error: unknown, fallback: string) {
  const response = (error as { response?: { data?: { error?: { message?: string } } } })?.response;
  return response?.data?.error?.message ?? (error instanceof Error ? error.message : fallback);
}

/* ------------------------------------------------------------------ */
/* Area                                                                */
/* ------------------------------------------------------------------ */

export function MailArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const queryClient = useQueryClient();
  const [mailboxId, setMailboxId] = useState<string | null>(null);
  const [folder, setFolder] = useState("INBOX");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [unansweredOnly, setUnansweredOnly] = useState(false);
  const [toFilter, setToFilter] = useState<string | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [openUid, setOpenUid] = useState<number | null>(null);
  const [compose, setCompose] = useState<ComposeDraft | null>(null);
  const [settings, setSettings] = useState<Mailbox | "new" | null>(null);
  const [aiRules, setAiRules] = useState(false);

  const mailboxes = useQuery({
    queryKey: ["mailboxes", orgSlug],
    queryFn: () => get<MailboxesResponse>(orgUrl(orgSlug, "mail/mailboxes")),
    refetchInterval: 60_000,
  });
  const list = mailboxes.data?.mailboxes ?? [];
  const current = list.find((item) => item.id === mailboxId) ?? null;

  // Deep links from notifications: ?mailbox=<id>&uid=<uid>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("mailbox");
    const uid = Number(params.get("uid"));
    if (wanted) setMailboxId(wanted);
    if (uid > 0) setOpenUid(uid);
  }, []);
  useEffect(() => {
    if (!mailboxId && list.length) setMailboxId(list[0]!.id);
  }, [list, mailboxId]);

  const base = mailboxId ? `mail/mailboxes/${mailboxId}` : "";
  const folders = useQuery({
    queryKey: ["mail-folders", orgSlug, mailboxId],
    queryFn: () => get<{ folders: Folder[] }>(orgUrl(orgSlug, `${base}/folders`)),
    enabled: Boolean(mailboxId) && current?.status !== "disabled",
    refetchInterval: 120_000,
  });
  // « À répondre » only makes sense for received mail.
  const folderKindNow = folders.data?.folders.find((item) => item.path === folder)?.kind ?? null;
  const canFilterToAnswer = !["\\Sent", "\\Drafts", "\\Trash", "\\Junk"].includes(folderKindNow ?? "");
  const toAnswer = unansweredOnly && canFilterToAnswer;
  const messages = useQuery({
    queryKey: ["mail-messages", orgSlug, mailboxId, folder, page, search, unreadOnly, toAnswer, toFilter],
    queryFn: () =>
      get<{ total: number; pageSize: number; messages: MessageSummary[] }>(orgUrl(orgSlug, `${base}/messages`), {
        params: { folder, page, search: search || undefined, unread: unreadOnly ? "true" : undefined, unanswered: toAnswer ? "true" : undefined, to: toFilter || undefined },
      }),
    enabled: Boolean(mailboxId) && current?.status !== "disabled",
    refetchInterval: 60_000,
    placeholderData: (previous) => previous,
  });
  const detail = useQuery({
    queryKey: ["mail-message", orgSlug, mailboxId, folder, openUid],
    queryFn: () =>
      get<{ message: MessageDetail }>(orgUrl(orgSlug, `${base}/messages/${openUid}`), { params: { folder } }),
    enabled: Boolean(mailboxId && openUid),
    staleTime: 60_000,
  });

  // Opening a message marks it read on the server; reflect it in the list.
  useEffect(() => {
    if (!detail.data) return;
    queryClient.setQueriesData<{ total: number; pageSize: number; messages: MessageSummary[] }>(
      { queryKey: ["mail-messages", orgSlug, mailboxId, folder] },
      (data) =>
        data
          ? { ...data, messages: data.messages.map((item) => (item.uid === openUid ? { ...item, seen: true } : item)) }
          : data,
    );
    void queryClient.invalidateQueries({ queryKey: ["mail-folders", orgSlug, mailboxId] });
  }, [detail.data, folder, mailboxId, openUid, orgSlug, queryClient]);

  const refreshLists = () => {
    void queryClient.invalidateQueries({ queryKey: ["mail-messages", orgSlug, mailboxId] });
    void queryClient.invalidateQueries({ queryKey: ["mail-folders", orgSlug, mailboxId] });
    void queryClient.invalidateQueries({ queryKey: ["mailboxes", orgSlug] });
  };

  const flags = useMutation({
    mutationFn: (input: { uid: number; seen?: boolean; flagged?: boolean }) =>
      patch(orgUrl(orgSlug, `${base}/messages/${input.uid}`), { folder, seen: input.seen, flagged: input.flagged }),
    onSuccess: refreshLists,
    onError: (error) => toast.error(errorMessage(error, tr(fr, "Action impossible.", "Action failed."))),
  });
  const markAllRead = useMutation({
    mutationFn: () =>
      post<{ updated: number }>(orgUrl(orgSlug, `${base}/mark-all-read`), { folder, to: toFilter || undefined }),
    onSuccess: (result) => {
      toast.success(tr(fr, `${result.updated} message(s) marqué(s) comme lu(s).`, `${result.updated} message(s) marked as read.`));
      refreshLists();
    },
    onError: (error) => toast.error(errorMessage(error, tr(fr, "Action impossible.", "Action failed."))),
  });
  const move = useMutation({
    mutationFn: (input: { uid: number; target: "trash" | "archive" | "inbox" | "junk" }) =>
      post(orgUrl(orgSlug, `${base}/messages/${input.uid}/move`), { folder, target: input.target }),
    onSuccess: (_data, input) => {
      toast.success(
        input.target === "trash"
          ? tr(fr, "Message mis à la corbeille.", "Moved to trash.")
          : input.target === "archive"
            ? tr(fr, "Message archivé.", "Archived.")
            : tr(fr, "Message déplacé.", "Moved."),
      );
      setOpenUid(null);
      refreshLists();
    },
    onError: (error) => toast.error(errorMessage(error, tr(fr, "Déplacement impossible.", "Could not move."))),
  });

  const openFolder = (path: string) => {
    setFolder(path);
    setPage(1);
    setOpenUid(null);
  };

  if (mailboxes.isLoading)
    return (
      <div className="p-4 sm:p-6">
        <SkeletonCard rows={8} />
      </div>
    );
  if (mailboxes.isError)
    return (
      <div className="p-4 sm:p-6">
        <ErrorState
          title={tr(fr, "Messagerie indisponible", "Mail unavailable")}
          description={errorMessage(mailboxes.error, "")}
          onRetry={() => void mailboxes.refetch()}
        />
      </div>
    );

  const data = mailboxes.data!;
  const folderList = folders.data?.folders ?? [];
  const totalPages = messages.data ? Math.max(1, Math.ceil(messages.data.total / messages.data.pageSize)) : 1;
  const message = detail.data?.message;

  const startReply = (mode: "reply" | "all" | "forward", aiAuto = false) => {
    if (!message) return;
    const subject = message.subject || "";
    const prefix = mode === "forward" ? "Tr: " : "Re: ";
    const clean = subject.replace(/^((re|tr|fwd?)\s*:\s*)+/i, "");
    const self = current?.emailAddress.toLowerCase();
    const replyTargets = message.replyTo.length ? message.replyTo : message.from;
    // Answer from the alias the message was sent to (e.g. recrutement@).
    const own = [current?.emailAddress ?? "", ...(current?.aliases ?? [])].map((item) => item.toLowerCase());
    const receivedOn = [...message.to, ...message.cc].map((item) => item.address.toLowerCase()).find((item) => own.includes(item));
    const others = [...message.to, ...message.cc].filter(
      (item) => item.address.toLowerCase() !== self && !own.includes(item.address.toLowerCase()),
    );
    setCompose({
      title:
        mode === "forward"
          ? tr(fr, "Transférer", "Forward")
          : mode === "all"
            ? tr(fr, "Répondre à tous", "Reply all")
            : tr(fr, "Répondre", "Reply"),
      fromAddress: message.receivedOn ?? receivedOn ?? toFilter ?? undefined,
      to: mode === "forward" ? "" : addresses(replyTargets),
      cc: mode === "all" ? addresses(others) : "",
      bcc: "",
      subject: `${prefix}${clean}`,
      body: "",
      replyToUid: message.uid,
      replyFolder: folder,
      forwardAttachments: mode === "forward",
      aiAuto,
    });
  };

  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-[560px] flex-col gap-3 p-3 sm:p-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
            <Mail className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-ink">{tr(fr, "Messagerie", "Mail")}</h1>
            {list.length > 1 ? (
              <select
                className="max-w-[260px] truncate rounded-md border border-border bg-surface-1 px-2 py-1 text-xs text-ink"
                value={mailboxId ?? ""}
                onChange={(event) => {
                  setMailboxId(event.target.value);
                  openFolder("INBOX");
                  setToFilter(null);
                }}
              >
                {list.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.emailAddress}
                    {item.unseenCount ? ` (${item.unseenCount})` : ""}
                  </option>
                ))}
              </select>
            ) : current ? (
              <p className="truncate text-xs text-ink-secondary">{current.emailAddress}</p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {current ? (
            <Button variant="secondary" size="sm" onClick={refreshLists} title={tr(fr, "Actualiser", "Refresh")}>
              <RefreshCw className={`size-3.5 ${messages.isFetching ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">{tr(fr, "Actualiser", "Refresh")}</span>
            </Button>
          ) : null}
          {data.canManage ? (
            <Button variant="secondary" size="sm" onClick={() => setAiRules(true)} title={tr(fr, "Consignes pour l’IA", "AI instructions")}>
              <Sparkles className="size-3.5" />
              <span className="hidden sm:inline">{tr(fr, "Consignes IA", "AI instructions")}</span>
            </Button>
          ) : null}
          {data.canManage ? (
            <Button variant="secondary" size="sm" onClick={() => setSettings(current ?? "new")}>
              <Settings2 className="size-3.5" />
              <span className="hidden sm:inline">{tr(fr, "Boîtes e-mail", "Mailboxes")}</span>
            </Button>
          ) : null}
          {current?.canSend ? (
            <Button
              size="sm"
              onClick={() =>
                setCompose({
                  title: tr(fr, "Nouveau message", "New message"),
                  fromAddress: toFilter ?? undefined,
                  to: "",
                  cc: "",
                  bcc: "",
                  subject: "",
                  body: "",
                })
              }
            >
              <PenSquare className="size-3.5" />
              {tr(fr, "Nouveau", "New")}
            </Button>
          ) : null}
        </div>
      </div>

      {!list.length ? (
        <div className="grid flex-1 place-items-center rounded-2xl border border-border bg-surface-1">
          <EmptyState
            icon={Mail}
            title={tr(fr, "Aucune boîte e-mail connectée", "No mailbox connected")}
            description={
              data.canManage
                ? tr(
                    fr,
                    "Connectez vos adresses Hostinger (recrutement@, contact@…) pour lire et répondre aux e-mails directement dans LiteHubs.",
                    "Connect your Hostinger addresses to read and answer e-mail directly in LiteHubs.",
                  )
                : tr(fr, "Aucune boîte ne vous a encore été attribuée.", "No mailbox has been assigned to you yet.")
            }
            action={
              data.canManage
                ? { label: tr(fr, "Connecter une boîte", "Connect a mailbox"), onClick: () => setSettings("new") }
                : undefined
            }
          />
        </div>
      ) : current?.status === "error" && !folders.data && folders.isError ? (
        <div className="grid flex-1 place-items-center rounded-2xl border border-border bg-surface-1 p-6">
          <ErrorState
            title={tr(fr, "Connexion à la boîte impossible", "Could not connect to the mailbox")}
            description={current.lastError ?? errorMessage(folders.error, "")}
            onRetry={() => void folders.refetch()}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 lg:grid lg:grid-cols-[220px_minmax(300px,380px)_1fr]">
          {/* Folders */}
          <nav className={`${openUid ? "hidden lg:block" : ""} shrink-0 overflow-auto rounded-2xl border border-border bg-surface-1 p-2 lg:min-h-0`}>
            <div className="flex gap-1 overflow-x-auto lg:flex-col">
              {folders.isLoading ? (
                <SkeletonCard rows={4} />
              ) : (
                folderList.map((item) => {
                  const Icon = folderIcon(item.kind);
                  const active = item.path === folder;
                  return (
                    <button
                      key={item.path}
                      type="button"
                      onClick={() => openFolder(item.path)}
                      className={`flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition ${
                        active ? "bg-brand/10 font-semibold text-brand" : "text-ink-secondary hover:bg-surface-2 hover:text-ink"
                      }`}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="truncate lg:flex-1">{folderLabel(item, fr)}</span>
                      {item.unseen ? (
                        <span className="rounded-full bg-brand px-1.5 text-[11px] font-bold text-brand-ink">{item.unseen}</span>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
            {current?.aliases?.length ? (
              <div className="mt-3 border-t border-border pt-3">
                <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  {tr(fr, "Reçus sur", "Received on")}
                </p>
                <div className="flex gap-1 overflow-x-auto lg:flex-col">
                  {[null, current.emailAddress, ...current.aliases].map((address) => {
                    const active = toFilter === address;
                    return (
                      <button
                        key={address ?? "all"}
                        type="button"
                        onClick={() => {
                          setToFilter(address);
                          setPage(1);
                          setOpenUid(null);
                        }}
                        className={`shrink-0 truncate rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                          active ? "bg-brand/10 font-semibold text-brand" : "text-ink-secondary hover:bg-surface-2 hover:text-ink"
                        }`}
                      >
                        {address ?? tr(fr, "Toutes les adresses", "All addresses")}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </nav>

          {/* Message list */}
          <section className={`${openUid ? "hidden lg:flex" : "flex"} min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface-1`}>
            <form
              className="flex items-center gap-2 border-b border-border p-2"
              onSubmit={(event) => {
                event.preventDefault();
                setSearch(searchInput.trim());
                setPage(1);
              }}
            >
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
                <Input
                  className="pl-8"
                  value={searchInput}
                  placeholder={tr(fr, "Rechercher…", "Search…")}
                  onChange={(event) => {
                    setSearchInput(event.target.value);
                    if (!event.target.value) {
                      setSearch("");
                      setPage(1);
                    }
                  }}
                />
              </div>
              {data.aiEnabled && current?.canSend ? (
                <button
                  type="button"
                  title={tr(fr, "Réponse groupée avec l’IA", "Batch AI replies")}
                  onClick={() => {
                    setBatchMode(!batchMode);
                    setSelected([]);
                  }}
                  className={`inline-flex h-9 shrink-0 items-center gap-1 rounded-md border px-2.5 text-xs font-semibold transition ${
                    batchMode ? "border-brand bg-brand text-brand-ink" : "border-brand/40 text-brand hover:bg-brand/[.06]"
                  }`}
                >
                  <Sparkles className="size-3.5" />
                  <span className="hidden sm:inline">{tr(fr, "Groupé", "Batch")}</span>
                </button>
              ) : null}
            </form>
            {toAnswer ? (
              <p className="border-b border-border bg-brand/5 px-3 py-1.5 text-[11px] leading-4 text-ink-secondary">
                {tr(
                  fr,
                  "À répondre : messages reçus de vrais contacts auxquels personne n’a encore répondu — ni ici, ni depuis le webmail Hostinger ou le téléphone. Les e-mails automatiques (no-reply, notifications) et nos propres envois sont exclus.",
                  "To answer: messages from real contacts that nobody has answered yet — here, in Hostinger webmail or on a phone. Automatic e-mails (no-reply, notifications) and our own messages are excluded.",
                )}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-2 py-1.5">
              {[
                { key: "all", label: tr(fr, "Tous", "All"), active: !unreadOnly && !toAnswer },
                { key: "unread", label: tr(fr, "Non lus", "Unread"), active: unreadOnly },
                ...(canFilterToAnswer
                  ? [{ key: "unanswered", label: tr(fr, "À répondre", "To answer"), active: toAnswer }]
                  : []),
              ].map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  title={
                    chip.key === "unanswered"
                      ? tr(fr, "Messages reçus auxquels nous n’avons pas encore répondu", "Messages received that we have not answered yet")
                      : undefined
                  }
                  onClick={() => {
                    setUnreadOnly(chip.key === "unread" ? !unreadOnly : chip.key === "all" ? false : unreadOnly);
                    setUnansweredOnly(chip.key === "unanswered" ? !toAnswer : chip.key === "all" ? false : toAnswer);
                    setPage(1);
                  }}
                  className={`h-7 rounded-full border px-2.5 text-xs font-semibold transition ${
                    chip.active ? "border-brand bg-brand/10 text-brand" : "border-border text-ink-secondary hover:bg-surface-2"
                  }`}
                >
                  {chip.label}
                </button>
              ))}
              <span className="flex-1" />
              <button
                type="button"
                disabled={markAllRead.isPending}
                onClick={async () => {
                  const ok = await Promise.resolve(
                    window.confirm(
                      toFilter
                        ? tr(fr, `Marquer tous les messages reçus sur ${toFilter} comme lus ?`, `Mark all messages received on ${toFilter} as read?`)
                        : tr(fr, "Marquer tous les messages de ce dossier comme lus ?", "Mark every message in this folder as read?"),
                    ),
                  );
                  if (ok) markAllRead.mutate();
                }}
                className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-semibold text-ink-secondary transition hover:bg-surface-2 hover:text-ink disabled:opacity-50"
              >
                <CheckCheck className="size-3.5" />
                {tr(fr, "Tout marquer lu", "Mark all read")}
              </button>
            </div>
            {batchMode ? (
              <div className="flex flex-wrap items-center gap-2 border-b border-border bg-brand/[.05] px-3 py-2 text-xs">
                <span className="font-semibold text-ink">
                  {selected.length} {tr(fr, "sélectionné(s)", "selected")} · max 20
                </span>
                <button
                  type="button"
                  className="font-semibold text-brand hover:underline"
                  onClick={() =>
                    setSelected(
                      (messages.data?.messages ?? [])
                        .filter((item) => !item.seen && !item.answered)
                        .map((item) => item.uid)
                        .slice(0, 20),
                    )
                  }
                >
                  {tr(fr, "Sélectionner les non lus", "Select unread")}
                </button>
                <span className="flex-1" />
                <Button size="sm" disabled={!selected.length} onClick={() => setBatchOpen(true)}>
                  <Sparkles className="size-3.5" />
                  {tr(fr, "Préparer les réponses", "Prepare replies")}
                </Button>
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-auto">
              {messages.isLoading ? (
                <div className="p-3">
                  <SkeletonCard rows={6} />
                </div>
              ) : messages.isError ? (
                <ErrorState
                  title={tr(fr, "Messages indisponibles", "Messages unavailable")}
                  description={errorMessage(messages.error, "")}
                  onRetry={() => void messages.refetch()}
                />
              ) : !messages.data?.messages.length ? (
                <EmptyState
                  icon={MailOpen}
                  title={search ? tr(fr, "Aucun résultat", "No results") : tr(fr, "Aucun message", "No messages")}
                />
              ) : (
                <ul>
                  {messages.data.messages.map((item) => (
                    <li key={item.uid}>
                      <button
                        type="button"
                        onClick={() => {
                          if (!batchMode) return setOpenUid(item.uid);
                          setSelected((current) =>
                            current.includes(item.uid)
                              ? current.filter((uid) => uid !== item.uid)
                              : current.length >= 20
                                ? current
                                : [...current, item.uid],
                          );
                        }}
                        className={`flex w-full gap-2.5 border-b border-border/70 px-3 py-2.5 text-left transition hover:bg-surface-2 ${
                          openUid === item.uid ? "bg-brand/[.07]" : ""
                        }`}
                      >
                        {batchMode ? (
                          <input
                            type="checkbox"
                            readOnly
                            tabIndex={-1}
                            checked={selected.includes(item.uid)}
                            className="mt-1 size-4 shrink-0 accent-[var(--color-brand)]"
                          />
                        ) : (
                          <span className={`mt-1.5 size-2 shrink-0 rounded-full ${item.seen ? "bg-transparent" : "bg-brand"}`} />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className={`truncate text-sm ${item.seen ? "text-ink-secondary" : "font-semibold text-ink"}`}>
                              {folderIsSent(folderList, folder) ? `→ ${person(item.to)}` : person(item.from) || "—"}
                            </span>
                            <span className="shrink-0 text-[11px] text-ink-muted">{shortDate(item.date, fr)}</span>
                          </span>
                          <span className={`flex items-center gap-1 truncate text-[13px] ${item.seen ? "text-ink-secondary" : "font-medium text-ink"}`}>
                            {item.answered ? <Reply className="size-3 shrink-0 text-ink-muted" /> : null}
                            <span className="truncate">{item.subject || tr(fr, "(sans objet)", "(no subject)")}</span>
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
                          {item.flagged ? <Star className="size-3.5 fill-warning text-warning" /> : null}
                          {item.hasAttachments ? <Paperclip className="size-3.5 text-ink-muted" /> : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {messages.data && messages.data.total > messages.data.pageSize ? (
              <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-ink-secondary">
                <span>
                  {(page - 1) * messages.data.pageSize + 1}–{Math.min(page * messages.data.pageSize, messages.data.total)} / {messages.data.total}
                </span>
                <span className="flex gap-1">
                  <Button size="icon-sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Précédent">
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button size="icon-sm" variant="ghost" disabled={page >= totalPages} onClick={() => setPage(page + 1)} aria-label="Suivant">
                    <ChevronRight className="size-4" />
                  </Button>
                </span>
              </div>
            ) : null}
          </section>

          {/* Reader */}
          <section className={`${openUid ? "flex" : "hidden lg:flex"} min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface-1`}>
            {!openUid ? (
              <div className="grid flex-1 place-items-center">
                <EmptyState icon={MailOpen} title={tr(fr, "Sélectionnez un message", "Select a message")} />
              </div>
            ) : detail.isLoading ? (
              <div className="p-5">
                <SkeletonCard rows={8} />
              </div>
            ) : detail.isError || !message ? (
              <ErrorState
                title={tr(fr, "Message introuvable", "Message not found")}
                description={errorMessage(detail.error, "")}
                onRetry={() => void detail.refetch()}
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-1 border-b border-border p-2">
                  <Button size="sm" variant="ghost" className="lg:hidden" onClick={() => setOpenUid(null)}>
                    <ArrowLeft className="size-4" />
                  </Button>
                  {current?.canSend ? (
                    <>
                      <ToolButton icon={Reply} label={tr(fr, "Répondre", "Reply")} onClick={() => startReply("reply")} />
                      <ToolButton icon={ReplyAll} label={tr(fr, "Répondre à tous", "Reply all")} onClick={() => startReply("all")} />
                      <ToolButton icon={Forward} label={tr(fr, "Transférer", "Forward")} onClick={() => startReply("forward")} />
                      {data.aiEnabled ? (
                        <ToolButton icon={Sparkles} label={tr(fr, "Réponse IA", "AI reply")} onClick={() => startReply("reply", true)} />
                      ) : null}
                    </>
                  ) : null}
                  <span className="flex-1" />
                  <ToolButton
                    icon={Star}
                    label={message.flagged ? tr(fr, "Ne plus suivre", "Unflag") : tr(fr, "Suivre", "Flag")}
                    onClick={() => {
                      flags.mutate({ uid: message.uid, flagged: !message.flagged });
                      queryClient.setQueryData(["mail-message", orgSlug, mailboxId, folder, openUid], {
                        message: { ...message, flagged: !message.flagged },
                      });
                    }}
                    active={message.flagged}
                    compact
                  />
                  <ToolButton
                    icon={Mail}
                    label={tr(fr, "Marquer non lu", "Mark unread")}
                    onClick={() => {
                      flags.mutate({ uid: message.uid, seen: false });
                      setOpenUid(null);
                    }}
                    compact
                  />
                  <ToolButton icon={Archive} label={tr(fr, "Archiver", "Archive")} onClick={() => move.mutate({ uid: message.uid, target: "archive" })} compact />
                  <ToolButton icon={Trash2} label={tr(fr, "Supprimer", "Delete")} onClick={() => move.mutate({ uid: message.uid, target: "trash" })} compact />
                </div>
                <div className="border-b border-border px-4 py-3 sm:px-5">
                  <h2 className="text-base font-semibold text-ink sm:text-lg">{message.subject || tr(fr, "(sans objet)", "(no subject)")}</h2>
                  <div className="mt-2 space-y-0.5 text-xs text-ink-secondary">
                    <p>
                      <span className="font-semibold text-ink">{person(message.from)}</span>{" "}
                      {message.from[0] ? <span>&lt;{message.from[0].address}&gt;</span> : null}
                    </p>
                    <p>
                      {tr(fr, "À :", "To:")} {person(message.to)}
                      {message.cc.length ? ` · Cc : ${person(message.cc)}` : ""}
                    </p>
                    <p>{fullDate(message.date, fr)}</p>
                  </div>
                  {message.candidates.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {message.candidates.map((candidate) => (
                        <a
                          key={candidate.id}
                          href={`/${orgSlug}/careers`}
                          className="inline-flex items-center gap-1.5 rounded-full border border-brand/25 bg-brand/[.06] px-3 py-1 text-xs font-medium text-brand hover:bg-brand/10"
                        >
                          <BriefcaseBusiness className="size-3.5" />
                          {tr(fr, "Candidat", "Candidate")} · {candidate.fullName} · {candidate.jobTitle}
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {message.attachments.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {message.attachments.map((attachment) => (
                        <AttachmentChip
                          key={attachment.index}
                          orgSlug={orgSlug}
                          base={base}
                          uid={message.uid}
                          folder={folder}
                          attachment={attachment}
                          fr={fr}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
                <EmailBody html={message.html} />
              </>
            )}
          </section>
        </div>
      )}

      {batchOpen && current ? (
        <BatchReplyDialog
          orgSlug={orgSlug}
          mailbox={current}
          folder={folder}
          items={(messages.data?.messages ?? []).filter((item) => selected.includes(item.uid))}
          fr={fr}
          onClose={() => setBatchOpen(false)}
          onFinished={() => {
            setBatchOpen(false);
            setBatchMode(false);
            setSelected([]);
            refreshLists();
          }}
        />
      ) : null}
      {compose && current ? (
        <ComposeDialog
          orgSlug={orgSlug}
          mailbox={current}
          draft={compose}
          aiEnabled={Boolean(data.aiEnabled)}
          fr={fr}
          onClose={() => setCompose(null)}
          onSent={() => {
            setCompose(null);
            refreshLists();
            if (openUid) void queryClient.invalidateQueries({ queryKey: ["mail-message", orgSlug, mailboxId] });
          }}
        />
      ) : null}
      {aiRules ? <AiInstructionsDialog orgSlug={orgSlug} fr={fr} onClose={() => setAiRules(false)} /> : null}
      {settings && data.canManage ? (
        <MailboxSettingsDialog
          orgSlug={orgSlug}
          data={data}
          initial={settings === "new" ? null : settings}
          fr={fr}
          onClose={() => setSettings(null)}
          onSaved={(saved) => {
            setSettings(null);
            setMailboxId(saved?.id ?? null);
            void queryClient.invalidateQueries({ queryKey: ["mailboxes", orgSlug] });
            void queryClient.invalidateQueries({ queryKey: ["mail-folders", orgSlug] });
            void queryClient.invalidateQueries({ queryKey: ["mail-messages", orgSlug] });
          }}
        />
      ) : null}
    </div>
  );
}

function folderIsSent(folders: Folder[], path: string) {
  return folders.find((item) => item.path === path)?.kind === "\\Sent";
}

function ToolButton({
  icon: Icon,
  label,
  onClick,
  active,
  compact,
}: {
  icon: typeof Reply;
  label: string;
  onClick: () => void;
  active?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition hover:bg-surface-2 ${
        active ? "text-warning" : "text-ink-secondary hover:text-ink"
      }`}
    >
      <Icon className={`size-4 ${active ? "fill-warning" : ""}`} />
      <span className={compact ? "sr-only" : "hidden sm:inline"}>{label}</span>
    </button>
  );
}

/** E-mail HTML is already sanitized by the API; the sandboxed frame also
 * blocks scripts, forms and access to LiteHubs from the message. */
function EmailBody({ html }: { html: string }) {
  const doc = useMemo(
    () =>
      `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
        body{margin:0;padding:18px 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f2933;background:#fff;word-wrap:break-word;overflow-wrap:anywhere}
        img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}
        blockquote{margin:6px 0;padding-left:12px;border-left:3px solid #d0d7de;color:#555}
        a{color:#1d4ed8}
      </style></head><body>${html}</body></html>`,
    [html],
  );
  return (
    <iframe
      title="Message"
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      className="min-h-0 w-full flex-1 bg-white"
    />
  );
}

function AttachmentChip({
  orgSlug,
  base,
  uid,
  folder,
  attachment,
  fr,
}: {
  orgSlug: string;
  base: string;
  uid: number;
  folder: string;
  attachment: MessageDetail["attachments"][number];
  fr: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const preview = attachment.mimeType === "application/pdf" || /^image\//.test(attachment.mimeType);
  const open = async () => {
    const target = preview ? window.open("", "_blank") : null;
    setBusy(true);
    try {
      const response = await api.get<Blob>(orgUrl(orgSlug, `${base}/messages/${uid}/attachments/${attachment.index}`), {
        params: { folder, view: preview ? "inline" : undefined },
        responseType: "blob",
      });
      const url = URL.createObjectURL(response.data);
      if (target) target.location.href = url;
      else {
        const link = document.createElement("a");
        link.href = url;
        link.download = attachment.fileName;
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      target?.close();
      toast.error(tr(fr, "Pièce jointe indisponible.", "Attachment unavailable."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={busy}
      className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-surface-2/50 px-2.5 py-1.5 text-xs text-ink transition hover:bg-surface-2"
    >
      <FileDown className="size-3.5 shrink-0 text-brand" />
      <span className="truncate">{attachment.fileName}</span>
      <span className="shrink-0 text-ink-muted">{sizeText(attachment.size)}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal>
      <div className={`flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface-1 shadow-2xl sm:max-h-[92dvh] sm:rounded-2xl ${wide ? "sm:max-w-3xl" : "sm:max-w-xl"}`}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-semibold text-ink">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-secondary hover:bg-surface-2" aria-label="Fermer">
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  );
}

function ComposeDialog({
  orgSlug,
  mailbox,
  draft,
  aiEnabled,
  fr,
  onClose,
  onSent,
}: {
  orgSlug: string;
  mailbox: Mailbox;
  draft: ComposeDraft;
  aiEnabled: boolean;
  fr: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const [form, setForm] = useState(draft);
  const [showCc, setShowCc] = useState(Boolean(draft.cc || draft.bcc));
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const send = useMutation({
    mutationFn: async () => {
      const data = new FormData();
      if (form.fromAddress) data.append("fromAddress", form.fromAddress);
      data.append("to", form.to);
      if (form.cc) data.append("cc", form.cc);
      if (form.bcc) data.append("bcc", form.bcc);
      data.append("subject", form.subject);
      data.append("body", form.body);
      if (form.replyToUid && form.replyFolder) {
        data.append("replyToUid", String(form.replyToUid));
        data.append("replyFolder", form.replyFolder);
      }
      if (form.forwardAttachments) data.append("forwardAttachments", "true");
      files.forEach((file) => data.append("attachments", file));
      return api.post(orgUrl(orgSlug, `mail/mailboxes/${mailbox.id}/send`), data);
    },
    onSuccess: () => {
      toast.success(tr(fr, "Message envoyé.", "Message sent."));
      onSent();
    },
    onError: (error) => toast.error(errorMessage(error, tr(fr, "Envoi impossible.", "Could not send."))),
  });
  const set = (key: keyof ComposeDraft, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const [aiOpen, setAiOpen] = useState(Boolean(draft.aiAuto));
  const [aiInstructions, setAiInstructions] = useState("");
  const [aiTone, setAiTone] = useState<"professional" | "friendly" | "formal" | "short">("professional");
  const ai = useMutation({
    mutationFn: (mode: "reply" | "forward" | "new" | "improve") =>
      post<{ draft: { subject: string; body: string }; usage: { used: number; limit: number } }>(
        orgUrl(orgSlug, `mail/mailboxes/${mailbox.id}/ai-draft`),
        {
          mode,
          uid: draft.replyToUid,
          folder: draft.replyFolder,
          instructions: aiInstructions.trim() || undefined,
          currentDraft: mode === "improve" ? form.body : undefined,
          tone: aiTone,
        },
      ),
    onSuccess: (result) => {
      setForm((current) => ({
        ...current,
        subject: current.subject.trim() ? current.subject : result.draft.subject,
        body: result.draft.body,
      }));
      toast.success(
        tr(
          fr,
          `Brouillon proposé par l’IA — relisez-le avant d’envoyer (${result.usage.used}/${result.usage.limit} aujourd’hui).`,
          `AI draft ready — review it before sending (${result.usage.used}/${result.usage.limit} today).`,
        ),
      );
    },
    onError: (error) => toast.error(errorMessage(error, tr(fr, "L’assistant IA est indisponible.", "The AI assistant is unavailable."))),
  });
  const draftMode = draft.replyToUid ? (draft.forwardAttachments ? "forward" : "reply") : "new";
  const autoStarted = useRef(false);
  useEffect(() => {
    if (draft.aiAuto && aiEnabled && !autoStarted.current) {
      autoStarted.current = true;
      ai.mutate(draftMode);
    }
  }, [ai, aiEnabled, draft.aiAuto, draftMode]);
  return (
    <Dialog title={form.title} onClose={onClose} wide>
      <form
        className="space-y-3 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          send.mutate();
        }}
      >
        {mailbox.aliases?.length ? (
          <Field label={tr(fr, "De", "From")}>
            <select
              className="h-10 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
              value={form.fromAddress ?? mailbox.emailAddress}
              onChange={(event) => set("fromAddress", event.target.value)}
            >
              {[mailbox.emailAddress, ...mailbox.aliases].map((address) => (
                <option key={address} value={address}>
                  {mailbox.displayName ? `${mailbox.displayName} <${address}>` : address}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <p className="text-xs text-ink-secondary">
            {tr(fr, "De :", "From:")} <span className="font-medium text-ink">{mailbox.displayName ? `${mailbox.displayName} <${mailbox.emailAddress}>` : mailbox.emailAddress}</span>
          </p>
        )}
        <Field label={tr(fr, "À", "To")} required>
          <div className="flex gap-2">
            <Input required value={form.to} placeholder="nom@exemple.com, autre@exemple.com" onChange={(event) => set("to", event.target.value)} />
            {!showCc ? (
              <Button type="button" variant="ghost" onClick={() => setShowCc(true)}>
                Cc/Cci
              </Button>
            ) : null}
          </div>
        </Field>
        {showCc ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Cc">
              <Input value={form.cc} onChange={(event) => set("cc", event.target.value)} />
            </Field>
            <Field label={tr(fr, "Cci (copie cachée)", "Bcc")}>
              <Input value={form.bcc} onChange={(event) => set("bcc", event.target.value)} />
            </Field>
          </div>
        ) : null}
        <Field label={tr(fr, "Objet", "Subject")}>
          <Input value={form.subject} onChange={(event) => set("subject", event.target.value)} />
        </Field>
        {aiEnabled ? (
          <div className="rounded-xl border border-brand/20 bg-brand/[.04] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" onClick={() => setAiOpen(!aiOpen)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand">
                <Sparkles className="size-4" />
                {tr(fr, "Assistant IA", "AI assistant")}
              </button>
              {!aiOpen ? (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="secondary" loading={ai.isPending} onClick={() => ai.mutate(draftMode)}>
                    {draft.replyToUid ? tr(fr, "Proposer une réponse", "Suggest a reply") : tr(fr, "Rédiger", "Draft")}
                  </Button>
                  {form.body.trim() ? (
                    <Button type="button" size="sm" variant="secondary" loading={ai.isPending} onClick={() => ai.mutate("improve")}>
                      {tr(fr, "Améliorer mon texte", "Improve my text")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
            {aiOpen ? (
              <div className="mt-3 space-y-2">
                <Textarea
                  rows={2}
                  maxLength={1500}
                  value={aiInstructions}
                  onChange={(event) => setAiInstructions(event.target.value)}
                  placeholder={tr(
                    fr,
                    "Ex. : remercier le candidat et l’inviter à un entretien lundi à 10h au bureau de Kinshasa.",
                    "E.g. thank the candidate and invite them to an interview on Monday at 10am.",
                  )}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="h-8 rounded-md border border-border bg-surface-1 px-2 text-xs text-ink"
                    value={aiTone}
                    onChange={(event) => setAiTone(event.target.value as typeof aiTone)}
                  >
                    <option value="professional">{tr(fr, "Ton professionnel", "Professional")}</option>
                    <option value="friendly">{tr(fr, "Ton chaleureux", "Friendly")}</option>
                    <option value="formal">{tr(fr, "Ton formel", "Formal")}</option>
                    <option value="short">{tr(fr, "Très court", "Very short")}</option>
                  </select>
                  <Button type="button" size="sm" loading={ai.isPending} onClick={() => ai.mutate(draftMode)}>
                    <Sparkles className="size-3.5" />
                    {draft.replyToUid ? tr(fr, "Proposer une réponse", "Suggest a reply") : tr(fr, "Rédiger", "Draft")}
                  </Button>
                  {form.body.trim() ? (
                    <Button type="button" size="sm" variant="secondary" loading={ai.isPending} onClick={() => ai.mutate("improve")}>
                      {tr(fr, "Améliorer mon texte", "Improve my text")}
                    </Button>
                  ) : null}
                </div>
                <p className="text-[11px] leading-4 text-ink-muted">
                  {tr(
                    fr,
                    "L’IA propose un brouillon : rien n’est envoyé sans votre relecture. Les informations manquantes apparaissent entre [crochets].",
                    "The AI only proposes a draft: nothing is sent without your review. Missing details appear in [brackets].",
                  )}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
        <Field label={tr(fr, "Message", "Message")}>
          <Textarea rows={10} value={form.body} autoFocus={!draft.aiAuto} onChange={(event) => set("body", event.target.value)} />
        </Field>
        {mailbox.signature ? (
          <p className="whitespace-pre-line rounded-lg bg-surface-2/50 px-3 py-2 text-xs text-ink-secondary">{mailbox.signature}</p>
        ) : null}
        {form.replyToUid ? (
          <p className="text-xs text-ink-muted">
            {form.forwardAttachments
              ? tr(fr, "Le message d’origine et ses pièces jointes seront inclus.", "The original message and its attachments will be included.")
              : tr(fr, "Le message d’origine sera cité sous votre réponse.", "The original message will be quoted below your reply.")}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              setFiles([...files, ...Array.from(event.target.files ?? [])].slice(0, 10));
              event.target.value = "";
            }}
          />
          <Button type="button" variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
            <Paperclip className="size-3.5" />
            {tr(fr, "Joindre", "Attach")}
          </Button>
          {files.map((file, index) => (
            <span key={`${file.name}-${index}`} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-ink">
              {file.name} · {sizeText(file.size)}
              <button type="button" onClick={() => setFiles(files.filter((_, i) => i !== index))} aria-label="Retirer">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            {tr(fr, "Annuler", "Cancel")}
          </Button>
          <Button loading={send.isPending}>
            <Send className="size-4" />
            {tr(fr, "Envoyer", "Send")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function MailboxSettingsDialog({
  orgSlug,
  data,
  initial,
  fr,
  onClose,
  onSaved,
}: {
  orgSlug: string;
  data: MailboxesResponse;
  initial: Mailbox | null;
  fr: boolean;
  onClose: () => void;
  onSaved: (saved: Mailbox | null) => void;
}) {
  const blank = {
    emailAddress: "",
    displayName: "",
    username: "",
    password: "",
    imapHost: "imap.hostinger.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.hostinger.com",
    smtpPort: 465,
    smtpSecure: true,
    signature: "",
    aliases: "",
    status: "active" as "active" | "disabled",
    memberIds: [] as string[],
  };
  const fromMailbox = (item: Mailbox) => ({
    ...blank,
    emailAddress: item.emailAddress,
    displayName: item.displayName ?? "",
    username: item.username && item.username !== item.emailAddress ? item.username : "",
    imapHost: item.imapHost ?? blank.imapHost,
    imapPort: item.imapPort ?? blank.imapPort,
    imapSecure: item.imapSecure ?? true,
    smtpHost: item.smtpHost ?? blank.smtpHost,
    smtpPort: item.smtpPort ?? blank.smtpPort,
    smtpSecure: item.smtpSecure ?? true,
    signature: item.signature ?? "",
    aliases: (item.aliases ?? []).join(", "),
    status: item.status === "disabled" ? ("disabled" as const) : ("active" as const),
    memberIds: item.memberIds ?? [],
  });
  const [selected, setSelected] = useState<Mailbox | null>(initial);
  const [form, setForm] = useState(initial ? fromMailbox(initial) : blank);
  const [advanced, setAdvanced] = useState(false);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        displayName: form.displayName || undefined,
        username: form.username || undefined,
        password: form.password || undefined,
        signature: form.signature || undefined,
        aliases: form.aliases
          .split(/[\s,;]+/)
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean),
      };
      return selected
        ? put<{ mailbox: Mailbox }>(orgUrl(orgSlug, `mail/mailboxes/${selected.id}`), body)
        : post<{ mailbox: Mailbox }>(orgUrl(orgSlug, "mail/mailboxes"), body);
    },
    onSuccess: (result) => {
      toast.success(tr(fr, "Boîte e-mail connectée.", "Mailbox connected."));
      onSaved(result.mailbox);
    },
    onError: (error) => toast.error(errorMessage(error, tr(fr, "Connexion impossible.", "Could not connect."))),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(orgUrl(orgSlug, `mail/mailboxes/${selected!.id}`)),
    onSuccess: () => {
      toast.success(tr(fr, "Boîte e-mail retirée de LiteHubs.", "Mailbox removed from LiteHubs."));
      onSaved(null);
    },
    onError: (error) => toast.error(errorMessage(error, "")),
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  const pick = (item: Mailbox | null) => {
    setSelected(item);
    setForm(item ? fromMailbox(item) : blank);
  };
  return (
    <Dialog title={tr(fr, "Boîtes e-mail", "Mailboxes")} onClose={onClose} wide>
      <div className="grid gap-0 sm:grid-cols-[200px_1fr]">
        <aside className="border-b border-border p-3 sm:border-b-0 sm:border-r">
          <div className="flex gap-1 overflow-x-auto sm:flex-col">
            {data.mailboxes.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => pick(item)}
                className={`shrink-0 rounded-lg px-2.5 py-2 text-left text-xs transition ${
                  selected?.id === item.id ? "bg-brand/10 font-semibold text-brand" : "text-ink-secondary hover:bg-surface-2"
                }`}
              >
                <span className="block truncate">{item.emailAddress}</span>
                <span className={`block text-[11px] ${item.status === "error" ? "text-critical" : "text-ink-muted"}`}>
                  {item.status === "error" ? tr(fr, "Erreur de connexion", "Connection error") : item.status === "disabled" ? tr(fr, "Désactivée", "Disabled") : tr(fr, "Connectée", "Connected")}
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => pick(null)}
              className={`shrink-0 rounded-lg border border-dashed px-2.5 py-2 text-left text-xs font-semibold transition ${
                !selected ? "border-brand text-brand" : "border-border text-ink-secondary hover:bg-surface-2"
              }`}
            >
              + {tr(fr, "Ajouter une adresse", "Add an address")}
            </button>
          </div>
        </aside>
        <form
          className="space-y-3 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          {selected?.status === "error" && selected.lastError ? (
            <p className="rounded-lg border border-critical/30 bg-critical/[.06] px-3 py-2 text-xs text-ink">{selected.lastError}</p>
          ) : null}
          <p className="rounded-lg bg-brand/[.05] px-3 py-2 text-xs leading-5 text-ink-secondary">
            {tr(
              fr,
              "Utilisez l’adresse et le mot de passe de la boîte créée dans Hostinger (hPanel → E-mails). LiteHubs vérifie la connexion avant d’enregistrer. Le mot de passe est chiffré et n’est jamais affiché.",
              "Use the address and password of the mailbox created in Hostinger (hPanel → Emails). LiteHubs tests the connection before saving. The password is encrypted and never shown.",
            )}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tr(fr, "Adresse e-mail", "E-mail address")} required>
              <Input required type="email" value={form.emailAddress} onChange={(event) => set("emailAddress", event.target.value)} placeholder="recrutement@congoomega.com" />
            </Field>
            <Field label={tr(fr, "Nom affiché", "Display name")}>
              <Input value={form.displayName} onChange={(event) => set("displayName", event.target.value)} placeholder="Congo Omega Recrutement" />
            </Field>
          </div>
          <Field
            label={tr(fr, "Mot de passe de la boîte", "Mailbox password")}
            required={!selected}
            hint={selected ? tr(fr, "Laissez vide pour garder le mot de passe actuel.", "Leave empty to keep the current password.") : undefined}
          >
            <Input type="password" autoComplete="new-password" required={!selected} value={form.password} onChange={(event) => set("password", event.target.value)} />
          </Field>
          <Field
            label={tr(fr, "Alias de cette boîte", "Aliases of this mailbox")}
            hint={tr(
              fr,
              "Ex. : recrutement@congoomega.com, contact@congoomega.com. Les alias Hostinger n’ont pas de mot de passe : ils arrivent dans cette boîte et peuvent servir d’adresse d’envoi.",
              "E.g. recrutement@congoomega.com. Hostinger aliases have no password: they deliver into this mailbox and can be used as the sender.",
            )}
          >
            <Input value={form.aliases} onChange={(event) => set("aliases", event.target.value)} placeholder="recrutement@congoomega.com, contact@congoomega.com" />
          </Field>
          <button type="button" className="text-xs font-semibold text-brand hover:underline" onClick={() => setAdvanced(!advanced)}>
            {advanced ? tr(fr, "Masquer les réglages serveur", "Hide server settings") : tr(fr, "Réglages serveur (Hostinger par défaut)", "Server settings (Hostinger by default)")}
          </button>
          {advanced ? (
            <div className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-3">
              <Field label={tr(fr, "Identifiant (si différent)", "Username (if different)")} className="sm:col-span-3">
                <Input value={form.username} onChange={(event) => set("username", event.target.value)} />
              </Field>
              <Field label="IMAP" className="sm:col-span-2">
                <Input value={form.imapHost} onChange={(event) => set("imapHost", event.target.value)} />
              </Field>
              <Field label="Port">
                <Input type="number" value={form.imapPort} onChange={(event) => set("imapPort", Number(event.target.value))} />
              </Field>
              <Field label="SMTP" className="sm:col-span-2">
                <Input value={form.smtpHost} onChange={(event) => set("smtpHost", event.target.value)} />
              </Field>
              <Field label="Port">
                <Input type="number" value={form.smtpPort} onChange={(event) => set("smtpPort", Number(event.target.value))} />
              </Field>
              <label className="flex items-center gap-2 text-xs text-ink sm:col-span-3">
                <input type="checkbox" checked={form.imapSecure && form.smtpSecure} onChange={(event) => setForm((current) => ({ ...current, imapSecure: event.target.checked, smtpSecure: event.target.checked }))} />
                SSL/TLS
              </label>
            </div>
          ) : null}
          <Field label={tr(fr, "Signature", "Signature")}>
            <Textarea rows={3} value={form.signature} onChange={(event) => set("signature", event.target.value)} placeholder={"Équipe Recrutement\nCongo Omega"} />
          </Field>
          <div>
            <p className="text-sm font-medium text-ink">{tr(fr, "Qui peut utiliser cette boîte ?", "Who can use this mailbox?")}</p>
            <p className="text-xs text-ink-secondary">
              {tr(
                fr,
                "Les responsables avec le droit « Gérer la messagerie » voient toutes les boîtes. Cochez les autres membres qui doivent lire et répondre.",
                "Managers with the mail management right see every mailbox. Tick the other members who should read and reply.",
              )}
            </p>
            <div className="mt-2 max-h-44 overflow-auto rounded-xl border border-border p-2">
              {data.members.map((member) => (
                <label key={member.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={form.memberIds.includes(member.id)}
                    onChange={(event) =>
                      set(
                        "memberIds",
                        event.target.checked ? [...form.memberIds, member.id] : form.memberIds.filter((id) => id !== member.id),
                      )
                    }
                  />
                  <span className="truncate">{member.name}</span>
                  <span className="truncate text-xs text-ink-muted">{member.email}</span>
                </label>
              ))}
            </div>
          </div>
          {selected ? (
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={form.status === "disabled"} onChange={(event) => set("status", event.target.checked ? "disabled" : "active")} />
              {tr(fr, "Désactiver temporairement", "Temporarily disable")}
            </label>
          ) : null}
          <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
            {selected ? (
              <Button
                type="button"
                variant="ghost"
                loading={remove.isPending}
                onClick={() => {
                  if (window.confirm(tr(fr, "Retirer cette boîte de LiteHubs ? Les e-mails restent sur Hostinger.", "Remove this mailbox from LiteHubs? E-mails stay on Hostinger.")))
                    remove.mutate();
                }}
              >
                <Trash2 className="size-4" />
                {tr(fr, "Retirer", "Remove")}
              </Button>
            ) : (
              <span />
            )}
            <Button loading={save.isPending}>
              {selected ? tr(fr, "Enregistrer", "Save") : tr(fr, "Tester et connecter", "Test and connect")}
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Batch AI replies: drafts for many messages, reviewed, then sent    */
/* ------------------------------------------------------------------ */

type BatchItem = {
  uid: number;
  name: string;
  originalSubject: string;
  to: string;
  fromAddress: string | null;
  subject: string;
  body: string;
  include: boolean;
  status: "pending" | "drafting" | "ready" | "error" | "sending" | "sent";
  error?: string;
};

function BatchReplyDialog({
  orgSlug,
  mailbox,
  folder,
  items,
  fr,
  onClose,
  onFinished,
}: {
  orgSlug: string;
  mailbox: Mailbox;
  folder: string;
  items: MessageSummary[];
  fr: boolean;
  onClose: () => void;
  onFinished: () => void;
}) {
  const [instructions, setInstructions] = useState("");
  const [tone, setTone] = useState<"professional" | "friendly" | "formal" | "short">("professional");
  const [phase, setPhase] = useState<"setup" | "drafting" | "review" | "sending" | "done">("setup");
  const [rows, setRows] = useState<BatchItem[]>(() =>
    items.map((item) => ({
      uid: item.uid,
      name: person(item.from) || "—",
      originalSubject: item.subject,
      to: addresses(item.from),
      fromAddress: null,
      subject: "",
      body: "",
      include: true,
      status: "pending",
    })),
  );
  const update = (uid: number, patchRow: Partial<BatchItem>) =>
    setRows((current) => current.map((row) => (row.uid === uid ? { ...row, ...patchRow } : row)));

  const generate = async () => {
    setPhase("drafting");
    let stop: string | null = null;
    for (const row of rows) {
      if (stop) {
        update(row.uid, { status: "error", error: stop, include: false });
        continue;
      }
      update(row.uid, { status: "drafting" });
      try {
        const result = await post<{
          draft: { subject: string; body: string };
          reply: { to: string[]; fromAddress: string | null } | null;
        }>(orgUrl(orgSlug, `mail/mailboxes/${mailbox.id}/ai-draft`), {
          mode: "reply",
          uid: row.uid,
          folder,
          instructions: instructions.trim() || undefined,
          tone,
        });
        update(row.uid, {
          status: "ready",
          subject: result.draft.subject,
          body: result.draft.body,
          to: result.reply?.to.join(", ") || row.to,
          fromAddress: result.reply?.fromAddress ?? null,
        });
      } catch (error) {
        const message = errorMessage(error, tr(fr, "Brouillon impossible.", "Draft failed."));
        const status = (error as { response?: { status?: number } })?.response?.status;
        // Daily limit or AI service down: no point trying the next ones.
        if (status === 429 || status === 503) stop = message;
        update(row.uid, { status: "error", error: message, include: false });
      }
    }
    setPhase("review");
  };

  const sendAll = async () => {
    setPhase("sending");
    for (const row of rows) {
      if (!row.include || row.status !== "ready") continue;
      update(row.uid, { status: "sending" });
      try {
        const data = new FormData();
        if (row.fromAddress) data.append("fromAddress", row.fromAddress);
        data.append("to", row.to);
        data.append("subject", row.subject);
        data.append("body", row.body);
        data.append("replyToUid", String(row.uid));
        data.append("replyFolder", folder);
        await api.post(orgUrl(orgSlug, `mail/mailboxes/${mailbox.id}/send`), data);
        update(row.uid, { status: "sent" });
      } catch (error) {
        update(row.uid, { status: "error", error: errorMessage(error, tr(fr, "Envoi impossible.", "Send failed.")) });
      }
    }
    setPhase("done");
  };

  const ready = rows.filter((row) => row.include && row.status === "ready").length;
  const sent = rows.filter((row) => row.status === "sent").length;
  const drafted = rows.filter((row) => !["pending", "drafting"].includes(row.status)).length;

  return (
    <Dialog
      title={tr(fr, `Réponses groupées · ${rows.length} message(s)`, `Batch replies · ${rows.length} message(s)`)}
      onClose={phase === "drafting" || phase === "sending" ? () => undefined : phase === "done" ? onFinished : onClose}
      wide
    >
      <div className="space-y-4 p-5">
        {phase === "setup" ? (
          <>
            <p className="text-sm leading-6 text-ink-secondary">
              {tr(
                fr,
                "L’IA va lire chaque message et préparer une réponse personnalisée. Vous pourrez tout relire et corriger avant l’envoi.",
                "The AI reads each message and prepares a personalised reply. You can review and edit everything before sending.",
              )}
            </p>
            <Field label={tr(fr, "Consigne commune (facultatif)", "Shared instruction (optional)")}>
              <Textarea
                rows={3}
                maxLength={1500}
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                placeholder={tr(
                  fr,
                  "Ex. : remercier, dire que le dossier est en cours d’examen et que nous répondrons sous 2 semaines.",
                  "E.g. thank them, say the application is under review and we will reply within 2 weeks.",
                )}
              />
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <select
                className="h-9 rounded-md border border-border bg-surface-1 px-2 text-sm text-ink"
                value={tone}
                onChange={(event) => setTone(event.target.value as typeof tone)}
              >
                <option value="professional">{tr(fr, "Ton professionnel", "Professional")}</option>
                <option value="friendly">{tr(fr, "Ton chaleureux", "Friendly")}</option>
                <option value="formal">{tr(fr, "Ton formel", "Formal")}</option>
                <option value="short">{tr(fr, "Très court", "Very short")}</option>
              </select>
              <Button onClick={() => void generate()}>
                <Sparkles className="size-4" />
                {tr(fr, "Préparer les réponses", "Prepare replies")}
              </Button>
            </div>
          </>
        ) : null}

        {phase !== "setup" ? (
          <div className="rounded-xl border border-border bg-surface-2/40 px-3 py-2 text-xs text-ink-secondary">
            {phase === "drafting"
              ? tr(fr, `Préparation… ${drafted}/${rows.length}`, `Preparing… ${drafted}/${rows.length}`)
              : phase === "sending"
                ? tr(fr, `Envoi… ${sent}/${ready + sent}`, `Sending… ${sent}/${ready + sent}`)
                : phase === "done"
                  ? tr(fr, `${sent} réponse(s) envoyée(s).`, `${sent} reply(ies) sent.`)
                  : tr(
                      fr,
                      `${ready} réponse(s) prête(s). Relisez, décochez celles à ne pas envoyer, puis « Tout envoyer ».`,
                      `${ready} reply(ies) ready. Review, untick any you do not want to send, then "Send all".`,
                    )}
          </div>
        ) : null}

        {phase !== "setup"
          ? rows.map((row) => (
              <article
                key={row.uid}
                className={`rounded-xl border p-3 ${row.status === "sent" ? "border-emerald-500/30 bg-emerald-500/[.04]" : row.status === "error" ? "border-critical/30 bg-critical/[.03]" : "border-border"}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  {phase === "review" && row.status === "ready" ? (
                    <input
                      type="checkbox"
                      checked={row.include}
                      onChange={(event) => update(row.uid, { include: event.target.checked })}
                      className="size-4 accent-[var(--color-brand)]"
                    />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                    {row.name} <span className="font-normal text-ink-secondary">· {row.originalSubject || "—"}</span>
                  </span>
                  <span className="text-[11px] font-semibold text-ink-muted">
                    {row.status === "drafting"
                      ? tr(fr, "IA en cours…", "Drafting…")
                      : row.status === "pending"
                        ? tr(fr, "En attente", "Waiting")
                        : row.status === "sending"
                          ? tr(fr, "Envoi…", "Sending…")
                          : row.status === "sent"
                            ? tr(fr, "Envoyé ✓", "Sent ✓")
                            : row.status === "error"
                              ? tr(fr, "Erreur", "Error")
                              : ""}
                  </span>
                </div>
                {row.status === "error" && row.error ? <p className="mt-1 text-xs text-critical">{row.error}</p> : null}
                {row.status === "ready" && phase === "review" ? (
                  <div className="mt-2 space-y-2">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input value={row.to} onChange={(event) => update(row.uid, { to: event.target.value })} aria-label={tr(fr, "À", "To")} />
                      <Input value={row.subject} onChange={(event) => update(row.uid, { subject: event.target.value })} aria-label={tr(fr, "Objet", "Subject")} />
                    </div>
                    <Textarea rows={5} value={row.body} onChange={(event) => update(row.uid, { body: event.target.value })} />
                    {/\[[^\]]+\]/.test(row.body) ? (
                      <p className="text-[11px] text-warning">
                        {tr(fr, "Complétez les éléments entre [crochets] avant l’envoi.", "Fill in the [bracketed] details before sending.")}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))
          : null}

        {phase === "review" ? (
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="ghost" onClick={onClose}>
              {tr(fr, "Annuler", "Cancel")}
            </Button>
            <Button
              disabled={!ready}
              onClick={() => {
                const unfinished = rows.some((row) => row.include && row.status === "ready" && /\[[^\]]+\]/.test(row.body));
                if (
                  unfinished &&
                  !window.confirm(
                    tr(fr, "Certaines réponses contiennent encore des [crochets]. Envoyer quand même ?", "Some replies still contain [brackets]. Send anyway?"),
                  )
                )
                  return;
                void sendAll();
              }}
            >
              <Send className="size-4" />
              {tr(fr, `Tout envoyer (${ready})`, `Send all (${ready})`)}
            </Button>
          </div>
        ) : null}
        {phase === "done" ? (
          <div className="flex justify-end border-t border-border pt-4">
            <Button onClick={onFinished}>{tr(fr, "Terminer", "Done")}</Button>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
