"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Ban,
  Bot,
  CheckCircle2,
  FileText,
  Globe2,
  ImageIcon,
  LockKeyhole,
  Megaphone,
  MessagesSquare,
  Paperclip,
  Pin,
  PinOff,
  Plus,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/ui/states";
import { api, del, get, orgUrl, patch, post, put } from "@/lib/api";
import { useLanguage } from "@/providers/language-provider";
import { AiInstructionsDialog } from "@/components/ai/ai-instructions-dialog";
import { PlatformBadge } from "./social-area";

type Overview = {
  visitors?: { enabled: boolean; pending: number } | null;
  me: {
    memberId: string;
    isOwner: boolean;
    canModerate: boolean;
    canReadDirection: boolean;
    blocked?: boolean;
    directionLabel?: string;
  };
  team: { id: string; unread: number } | null;
  myDirection: { id: string; unread: number } | null;
  threads: { id: string; employee: { id: string; name: string }; lastMessageAt: string; preview: string; unread: number }[];
  members: { id: string; name: string }[];
};
type ChatMessage = {
  id: string;
  author: { id: string; name: string } | null;
  authorIsDirection: boolean;
  body: string | null;
  deleted: boolean;
  isAnnouncement: boolean;
  pinned: boolean;
  file: { name: string; mimeType: string; size: number } | null;
  createdAt: string;
  mine: boolean;
  canDelete: boolean;
  canPin: boolean;
};
type Conversation = {
  conversation: {
    id: string;
    kind: "team" | "direction";
    employee: { id: string; name: string | null } | null;
    canAnnounce: boolean;
    composer?: { canWrite: boolean; canSendImages: boolean; canSendDocuments: boolean; reason: "muted" | "read_only" | null };
  };
  messages: ChatMessage[];
  pinned: ChatMessage[];
  hasMore: boolean;
};

const tr = (fr: boolean, french: string, english: string) => (fr ? french : english);
const errorMessage = (error: unknown, fallback: string) =>
  (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
  (error instanceof Error ? error.message : fallback);
const sizeText = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`;
const time = (value: string, fr: boolean) => {
  const date = new Date(value);
  const today = new Date().toDateString() === date.toDateString();
  return date.toLocaleString(fr ? "fr-FR" : "en-GB", today ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export function ChatArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const queryClient = useQueryClient();
  const [active, setActive] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  const [picker, setPicker] = useState(false);
  const [settings, setSettings] = useState(false);
  const [tab, setTab] = useState<"team" | "visitors">("team");
  const [aiRules, setAiRules] = useState(false);
  const [visitor, setVisitor] = useState<string | null>(null);

  const overview = useQuery({
    queryKey: ["chat-overview", orgSlug],
    queryFn: () => get<Overview>(orgUrl(orgSlug, "chat")),
    refetchInterval: 10_000,
  });
  const data = overview.data;

  // Deep link from a notification: ?c=<conversation id>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("c");
    const wantedVisitor = params.get("visitor");
    if (wantedVisitor) {
      setTab("visitors");
      setVisitor(wantedVisitor);
      setMobileView("chat");
    } else if (wanted) {
      setActive(wanted);
      setMobileView("chat");
    }
  }, []);
  // On a wide screen the team room opens by default.  On a phone the list is
  // shown first, and nothing is opened (or marked as read) until tapped.
  useEffect(() => {
    const first = data?.team?.id ?? data?.myDirection?.id ?? null;
    if (!active && first && window.matchMedia("(min-width: 1024px)").matches) setActive(first);
  }, [active, data]);

  const openDirection = useMutation({
    mutationFn: (memberId?: string) => post<{ id: string }>(orgUrl(orgSlug, "chat/direction"), memberId ? { memberId } : {}),
    onSuccess: (result) => {
      setActive(result.id);
      setMobileView("chat");
      setPicker(false);
      void queryClient.invalidateQueries({ queryKey: ["chat-overview", orgSlug] });
    },
    onError: (error) => toast.error(errorMessage(error, "")),
  });

  if (overview.isLoading)
    return (
      <div className="p-4 sm:p-6">
        <SkeletonCard rows={8} />
      </div>
    );
  if (overview.isError || !data)
    return (
      <div className="p-4 sm:p-6">
        <ErrorState title={tr(fr, "Chat indisponible", "Chat unavailable")} description={errorMessage(overview.error, "")} onRetry={() => void overview.refetch()} />
      </div>
    );

  const isStaff = data.me.canReadDirection;
  const select = (id: string) => {
    setActive(id);
    setMobileView("chat");
  };

  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-[520px] gap-3 p-3 sm:p-5">
      {/* Conversations */}
      <aside className={`${mobileView === "chat" ? "hidden lg:flex" : "flex"} w-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface-1 lg:w-80 lg:shrink-0`}>
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl bg-brand/10 text-brand">
              <MessagesSquare className="size-5" />
            </span>
            <h1 className="text-lg font-semibold text-ink">{tr(fr, "Chat", "Chat")}</h1>
          </div>
          {data.me.isOwner || data.me.canModerate ? (
            <div className="flex items-center gap-1">
              <Button size="icon-sm" variant="ghost" title={tr(fr, "Consignes pour l’IA", "AI instructions")} onClick={() => setAiRules(true)}>
                <Sparkles className="size-4" />
              </Button>
              <Button size="icon-sm" variant="ghost" title={tr(fr, "Accès au chat", "Chat access")} onClick={() => setSettings(true)}>
                <Settings2 className="size-4" />
              </Button>
            </div>
          ) : null}
        </div>
        {data.visitors ? (
          <div className="grid grid-cols-2 gap-1 border-b border-border p-2">
            {(["team", "visitors"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-[13px] font-medium transition ${tab === key ? "bg-brand/10 text-brand" : "text-ink-secondary hover:bg-surface-2"}`}
              >
                {key === "team" ? <UsersRound className="size-4" /> : <Globe2 className="size-4" />}
                {key === "team" ? tr(fr, "Équipe", "Team") : tr(fr, "Clients", "Customers")}
                {key === "visitors" && data.visitors!.pending ? (
                  <span className="rounded-full bg-critical px-1.5 text-[11px] font-bold text-white">{data.visitors!.pending}</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
        {tab === "visitors" && data.visitors ? (
          <VisitorList
            orgSlug={orgSlug}
            fr={fr}
            enabled={data.visitors.enabled}
            active={visitor}
            onSelect={(id) => {
              setVisitor(id);
              setMobileView("chat");
            }}
          />
        ) : (
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {data.team ? (
            <ConversationButton
              active={active === data.team.id}
              onClick={() => select(data.team!.id)}
              icon={<UsersRound className="size-4" />}
              title={tr(fr, "Équipe · tout le monde", "Team · everyone")}
              subtitle={tr(fr, "Tous les employés, toutes provinces", "All employees, all provinces")}
              unread={data.team.unread}
              tone="brand"
            />
          ) : (
            <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left opacity-70">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-3 text-ink-muted">
                <Ban className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{tr(fr, "Chat d’équipe", "Team chat")}</span>
                <span className="block truncate text-xs text-ink-secondary">
                  {tr(fr, "Accès retiré par la direction", "Access removed by management")}
                </span>
              </span>
            </div>
          )}
          {!isStaff ? (
            <ConversationButton
              active={Boolean(data.myDirection && active === data.myDirection.id)}
              onClick={() => (data.myDirection ? select(data.myDirection.id) : openDirection.mutate(undefined))}
              icon={<LockKeyhole className="size-4" />}
              title={tr(fr, "Message privé à la direction", "Private message to management")}
              subtitle={tr(fr, "Seule la direction le voit", "Only management can see it")}
              unread={data.myDirection?.unread ?? 0}
              tone="private"
            />
          ) : (
            <>
              <div className="mt-4 flex items-center justify-between px-2 pb-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{tr(fr, "Messages privés", "Private messages")}</p>
                <button type="button" onClick={() => setPicker(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                  <Plus className="size-3.5" />
                  {tr(fr, "Nouveau", "New")}
                </button>
              </div>
              {data.threads.length ? (
                data.threads.map((thread) => (
                  <ConversationButton
                    key={thread.id}
                    active={active === thread.id}
                    onClick={() => select(thread.id)}
                    icon={<span className="text-[11px] font-bold">{initials(thread.employee.name)}</span>}
                    title={thread.employee.name}
                    subtitle={thread.preview || "—"}
                    unread={thread.unread}
                    tone="private"
                  />
                ))
              ) : (
                <p className="px-3 py-3 text-xs leading-5 text-ink-secondary">
                  {tr(fr, "Aucun message privé pour l’instant. Les employés peuvent écrire à la direction en toute discrétion.", "No private messages yet. Employees can write to management privately.")}
                </p>
              )}
            </>
          )}
        </div>
        )}
      </aside>

      {/* Conversation */}
      <section className={`${mobileView === "list" ? "hidden lg:flex" : "flex"} min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface-1`}>
        {tab === "visitors" && data.visitors ? (
          visitor ? (
            <VisitorView
              key={visitor}
              orgSlug={orgSlug}
              sessionId={visitor}
              fr={fr}
              onBack={() => setMobileView("list")}
              onActivity={() => {
                void queryClient.invalidateQueries({ queryKey: ["chat-overview", orgSlug] });
                void queryClient.invalidateQueries({ queryKey: ["chat-visitors", orgSlug] });
              }}
            />
          ) : (
            <div className="grid flex-1 place-items-center">
              <EmptyState icon={Globe2} title={tr(fr, "Choisissez un visiteur", "Choose a visitor")} />
            </div>
          )
        ) : active ? (
          <ConversationView
            key={active}
            orgSlug={orgSlug}
            conversationId={active}
            fr={fr}
            onBack={() => setMobileView("list")}
            onActivity={() => void queryClient.invalidateQueries({ queryKey: ["chat-overview", orgSlug] })}
          />
        ) : (
          <div className="grid flex-1 place-items-center">
            <EmptyState icon={MessagesSquare} title={tr(fr, "Choisissez une conversation", "Choose a conversation")} />
          </div>
        )}
      </section>

      {picker ? (
        <Dialog title={tr(fr, "Nouveau message privé", "New private message")} onClose={() => setPicker(false)}>
          <MemberPicker members={data.members} fr={fr} onPick={(id) => openDirection.mutate(id)} />
        </Dialog>
      ) : null}
      {aiRules ? <AiInstructionsDialog orgSlug={orgSlug} fr={fr} onClose={() => setAiRules(false)} /> : null}
      {settings && data.me.isOwner ? <AccessDialog orgSlug={orgSlug} fr={fr} onClose={() => setSettings(false)} /> : null}
      {settings && !data.me.isOwner ? (
        <LabelDialog
          orgSlug={orgSlug}
          fr={fr}
          initial={data.me.directionLabel ?? "Direction"}
          onClose={() => {
            setSettings(false);
            void queryClient.invalidateQueries({ queryKey: ["chat-overview", orgSlug] });
          }}
        />
      ) : null}
    </div>
  );
}

function ConversationButton({
  active,
  onClick,
  icon,
  title,
  subtitle,
  unread,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  subtitle: string;
  unread: number;
  tone: "brand" | "private";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${active ? "bg-brand/10" : "hover:bg-surface-2"}`}
    >
      <span className={`grid size-9 shrink-0 place-items-center rounded-full ${tone === "brand" ? "bg-brand text-brand-ink" : "bg-ink/80 text-white"}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm ${unread ? "font-semibold text-ink" : "font-medium text-ink"}`}>{title}</span>
        <span className="block truncate text-xs text-ink-secondary">{subtitle}</span>
      </span>
      {unread ? <span className="rounded-full bg-brand px-1.5 py-0.5 text-[11px] font-bold text-brand-ink">{unread > 99 ? "99+" : unread}</span> : null}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* One conversation                                                    */
/* ------------------------------------------------------------------ */

function ConversationView({
  orgSlug,
  conversationId,
  fr,
  onBack,
  onActivity,
}: {
  orgSlug: string;
  conversationId: string;
  fr: boolean;
  onBack: () => void;
  onActivity: () => void;
}) {
  const queryClient = useQueryClient();
  const key = ["chat-messages", orgSlug, conversationId];
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [hasOlder, setHasOlder] = useState<boolean | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastSeen = useRef<string | null>(null);

  const messages = useQuery({
    queryKey: key,
    queryFn: () => get<Conversation>(orgUrl(orgSlug, `chat/conversations/${conversationId}/messages`)),
    refetchInterval: 4_000,
  });
  const data = messages.data;
  const all = useMemo(() => [...older, ...(data?.messages ?? [])], [older, data]);

  // Keep the view at the bottom unless the person scrolled up to read.
  useEffect(() => {
    const last = data?.messages.at(-1)?.id ?? null;
    if (last && last !== lastSeen.current) {
      lastSeen.current = last;
      onActivity();
      if (stickToBottom.current) requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight }));
    }
  }, [data, onActivity]);

  const loadOlder = async () => {
    const first = all[0];
    if (!first) return;
    const result = await get<Conversation>(orgUrl(orgSlug, `chat/conversations/${conversationId}/messages`), {
      params: { before: first.createdAt },
    });
    setOlder((current) => [...result.messages, ...current]);
    setHasOlder(result.hasMore);
  };

  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const remove = useMutation({
    mutationFn: (id: string) => del(orgUrl(orgSlug, `chat/messages/${id}`)),
    onSuccess: (_result, id) => {
      setOlder((current) => current.map((item) => (item.id === id ? { ...item, deleted: true, body: null, file: null } : item)));
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error, "")),
  });
  const pin = useMutation({
    mutationFn: (input: { id: string; pinned: boolean }) => patch(orgUrl(orgSlug, `chat/messages/${input.id}/pin`), { pinned: input.pinned }),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error, "")),
  });

  if (messages.isLoading)
    return (
      <div className="p-5">
        <SkeletonCard rows={6} />
      </div>
    );
  if (messages.isError || !data)
    return <ErrorState title={tr(fr, "Conversation indisponible", "Conversation unavailable")} description={errorMessage(messages.error, "")} onRetry={() => void messages.refetch()} />;

  const isTeam = data.conversation.kind === "team";
  const showOlder = hasOlder ?? data.hasMore;

  return (
    <>
      <header className="flex items-center gap-2 border-b border-border px-3 py-3 sm:px-4">
        <Button size="icon-sm" variant="ghost" className="lg:hidden" onClick={onBack} aria-label="Retour">
          <ArrowLeft className="size-4" />
        </Button>
        <span className={`grid size-9 shrink-0 place-items-center rounded-full ${isTeam ? "bg-brand text-brand-ink" : "bg-ink/80 text-white"}`}>
          {isTeam ? <UsersRound className="size-4" /> : <LockKeyhole className="size-4" />}
        </span>
        <div className="min-w-0">
          <h2 className="truncate font-semibold text-ink">
            {isTeam
              ? tr(fr, "Équipe · tout le monde", "Team · everyone")
              : data.conversation.employee?.name ?? tr(fr, "Message privé", "Private message")}
          </h2>
          <p className="truncate text-xs text-ink-secondary">
            {isTeam
              ? tr(fr, "Visible par tous les employés de toutes les provinces", "Visible to every employee in every province")
              : tr(fr, "Privé : seulement l’employé et la direction", "Private: only the employee and management")}
          </p>
        </div>
      </header>

      {isTeam && data.pinned.length ? (
        <div className="space-y-1 border-b border-border bg-warning/[.07] px-4 py-2">
          {data.pinned.map((item) => (
            <p key={item.id} className="flex items-start gap-2 text-xs text-ink">
              <Pin className="mt-0.5 size-3.5 shrink-0 text-warning" />
              <span className="line-clamp-2">
                <strong>{item.author?.name ?? "—"} :</strong> {item.body ?? item.file?.name}
              </span>
            </p>
          ))}
        </div>
      ) : null}

      <div
        ref={scroller}
        onScroll={(event) => {
          const target = event.currentTarget;
          stickToBottom.current = target.scrollHeight - target.scrollTop - target.clientHeight < 80;
        }}
        className="min-h-0 flex-1 space-y-3 overflow-auto bg-surface-2/30 px-3 py-4 sm:px-5"
      >
        {showOlder ? (
          <div className="text-center">
            <button type="button" onClick={() => void loadOlder()} className="rounded-full border border-border bg-surface-1 px-3 py-1 text-xs font-semibold text-ink-secondary hover:bg-surface-2">
              {tr(fr, "Messages précédents", "Earlier messages")}
            </button>
          </div>
        ) : null}
        {!all.length ? (
          <p className="py-10 text-center text-sm text-ink-secondary">
            {isTeam
              ? tr(fr, "Aucun message. Dites bonjour à l’équipe !", "No messages yet. Say hello to the team!")
              : tr(fr, "Écrivez votre message : seule la direction pourra le lire.", "Write your message: only management can read it.")}
          </p>
        ) : null}
        {all.map((item) => (
          <MessageBubble
            key={item.id}
            orgSlug={orgSlug}
            item={item}
            fr={fr}
            onDelete={() => {
              if (window.confirm(tr(fr, "Supprimer ce message ?", "Delete this message?"))) remove.mutate(item.id);
            }}
            onPin={() => pin.mutate({ id: item.id, pinned: !item.pinned })}
          />
        ))}
      </div>

      <Composer
        orgSlug={orgSlug}
        conversationId={conversationId}
        canAnnounce={data.conversation.canAnnounce}
        rules={data.conversation.composer}
        fr={fr}
        onSent={() => {
          stickToBottom.current = true;
          refresh();
          onActivity();
        }}
      />
    </>
  );
}

/** Turns URLs into links; LiteHubs links (projects…) open inside the app. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (!/^https?:\/\//.test(part)) return <span key={index}>{part}</span>;
        let internal = false;
        let label = part;
        try {
          const url = new URL(part);
          internal = url.origin === window.location.origin;
          if (internal && /\/projects/.test(url.pathname)) label = "📁 Ouvrir le projet";
        } catch {
          // keep the raw text
        }
        return (
          <a
            key={index}
            href={part}
            target={internal ? undefined : "_blank"}
            rel={internal ? undefined : "noopener noreferrer"}
            className="break-all font-medium underline underline-offset-2"
          >
            {label}
          </a>
        );
      })}
    </>
  );
}

function MessageBubble({
  orgSlug,
  item,
  fr,
  onDelete,
  onPin,
}: {
  orgSlug: string;
  item: ChatMessage;
  fr: boolean;
  onDelete: () => void;
  onPin: () => void;
}) {
  const mine = item.mine;
  return (
    <div className={`group flex gap-2 ${mine ? "flex-row-reverse" : ""}`}>
      {!mine ? (
        <span className="mt-5 grid size-8 shrink-0 place-items-center rounded-full bg-surface-3 text-[11px] font-bold text-ink-secondary">
          {initials(item.author?.name ?? "?")}
        </span>
      ) : null}
      <div className={`max-w-[82%] sm:max-w-[70%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
        <p className={`mb-0.5 flex items-center gap-1.5 px-1 text-[11px] text-ink-muted ${mine ? "flex-row-reverse" : ""}`}>
          {!mine ? (
            <span className={`font-semibold ${item.author?.id === "direction" ? "inline-flex items-center gap-1 text-brand" : "text-ink-secondary"}`}>
              {item.author?.id === "direction" ? <ShieldCheck className="size-3" /> : null}
              {item.author?.name ?? "—"}
            </span>
          ) : null}
          {item.authorIsDirection && item.author?.id !== "direction" ? (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-brand/10 px-1.5 text-[10px] font-semibold text-brand">
              <ShieldCheck className="size-3" />
              {tr(fr, "Direction", "Management")}
            </span>
          ) : null}
          <span>{time(item.createdAt, fr)}</span>
        </p>
        <div
          className={`rounded-2xl px-3.5 py-2 text-sm leading-6 shadow-sm ${
            item.deleted
              ? "border border-dashed border-border bg-transparent italic text-ink-muted"
              : item.isAnnouncement
                ? "border border-warning/40 bg-warning/[.12] text-ink"
                : mine
                  ? "bg-brand text-brand-ink"
                  : "border border-border bg-surface-1 text-ink"
          }`}
        >
          {item.deleted ? (
            tr(fr, "Message supprimé", "Message deleted")
          ) : (
            <>
              {item.isAnnouncement ? (
                <p className="mb-1 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-warning">
                  <Megaphone className="size-3.5" />
                  {tr(fr, "Annonce", "Announcement")}
                </p>
              ) : null}
              {item.body ? (
                <p className="whitespace-pre-wrap break-words">
                  <RichText text={item.body} />
                </p>
              ) : null}
              {item.file ? <Attachment orgSlug={orgSlug} messageId={item.id} file={item.file} mine={mine && !item.isAnnouncement} /> : null}
            </>
          )}
        </div>
        {!item.deleted && (item.canDelete || item.canPin) ? (
          <div className={`mt-0.5 flex gap-1 px-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 ${mine ? "flex-row-reverse" : ""}`}>
            {item.canPin ? (
              <button type="button" onClick={onPin} className="rounded p-1 text-ink-muted hover:bg-surface-2 hover:text-ink" title={item.pinned ? tr(fr, "Désépingler", "Unpin") : tr(fr, "Épingler", "Pin")}>
                {item.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
              </button>
            ) : null}
            {item.canDelete ? (
              <button type="button" onClick={onDelete} className="rounded p-1 text-ink-muted hover:bg-surface-2 hover:text-critical" title={tr(fr, "Supprimer", "Delete")}>
                <Trash2 className="size-3.5" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Attachment({
  orgSlug,
  messageId,
  file,
  mine,
}: {
  orgSlug: string;
  messageId: string;
  file: { name: string; mimeType: string; size: number };
  mine: boolean;
}) {
  const image = /^image\/(png|jpe?g|gif|webp)$/.test(file.mimeType);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!image) return;
    let active = true;
    let objectUrl: string | null = null;
    void api
      .get<Blob>(orgUrl(orgSlug, `chat/messages/${messageId}/file`), { params: { view: "inline" }, responseType: "blob" })
      .then((response) => {
        objectUrl = URL.createObjectURL(response.data);
        if (active) setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [image, messageId, orgSlug]);

  const open = async (download: boolean) => {
    const preview = !download && (image || file.mimeType === "application/pdf");
    const target = preview ? window.open("", "_blank") : null;
    try {
      const response = await api.get<Blob>(orgUrl(orgSlug, `chat/messages/${messageId}/file`), {
        params: preview ? { view: "inline" } : undefined,
        responseType: "blob",
      });
      const objectUrl = URL.createObjectURL(response.data);
      if (target) target.location.href = objectUrl;
      else {
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = file.name;
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch {
      target?.close();
      toast.error("Fichier indisponible.");
    }
  };

  if (image)
    return (
      <button type="button" onClick={() => void open(false)} className="mt-1 block overflow-hidden rounded-xl">
        {url ? (
          // A private, authenticated image shown from a local object URL.
          <img src={url} alt={file.name} className="max-h-72 w-auto max-w-full rounded-xl object-contain" />
        ) : (
          <span className="grid h-32 w-48 place-items-center rounded-xl bg-surface-2 text-ink-muted">
            <ImageIcon className="size-6" />
          </span>
        )}
      </button>
    );
  return (
    <button
      type="button"
      onClick={() => void open(false)}
      className={`mt-1 flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs ${mine ? "bg-white/15" : "bg-surface-2"}`}
    >
      <FileText className="size-5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{file.name}</span>
        <span className="opacity-80">{sizeText(file.size)}</span>
      </span>
    </button>
  );
}

function Composer({
  orgSlug,
  conversationId,
  canAnnounce,
  rules,
  fr,
  onSent,
}: {
  orgSlug: string;
  conversationId: string;
  canAnnounce: boolean;
  rules?: { canWrite: boolean; canSendImages: boolean; canSendDocuments: boolean; reason: "muted" | "read_only" | null };
  fr: boolean;
  onSent: () => void;
}) {
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [announcement, setAnnouncement] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const send = useMutation({
    mutationFn: () => {
      const data = new FormData();
      if (body.trim()) data.append("body", body.trim());
      if (announcement) data.append("announcement", "true");
      if (file) data.append("file", file);
      return api.post(orgUrl(orgSlug, `chat/conversations/${conversationId}/messages`), data);
    },
    onSuccess: () => {
      setBody("");
      setFile(null);
      setAnnouncement(false);
      onSent();
    },
    onError: (error) => toast.error(errorMessage(error, tr(fr, "Envoi impossible.", "Could not send."))),
  });
  const submit = () => {
    if ((body.trim() || file) && !send.isPending) send.mutate();
  };
  const canWrite = rules?.canWrite ?? true;
  const canImages = rules?.canSendImages ?? true;
  const canDocuments = rules?.canSendDocuments ?? true;
  const accept = [canImages ? "image/*" : "", canDocuments ? "application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" : ""].filter(Boolean).join(",");
  if (!canWrite)
    return (
      <div className="flex items-center gap-2 border-t border-border bg-surface-2/50 px-4 py-3 text-xs text-ink-secondary">
        <LockKeyhole className="size-4 shrink-0" />
        {rules?.reason === "muted"
          ? tr(fr, "Vous êtes en lecture seule dans ce chat. Vous pouvez toujours écrire à la direction en privé.", "You are read-only in this chat. You can still write to management privately.")
          : tr(fr, "Ce chat est en lecture seule : seuls les modérateurs peuvent écrire.", "This chat is read-only: only moderators can write.")}
      </div>
    );
  return (
    <div className="border-t border-border p-2 sm:p-3">
      {file ? (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5 text-xs text-ink">
          <Paperclip className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">{file.name} · {sizeText(file.size)}</span>
          <button type="button" onClick={() => setFile(null)} aria-label="Retirer">
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
      {canAnnounce ? (
        <label className="mb-2 inline-flex cursor-pointer items-center gap-1.5 px-1 text-xs font-medium text-ink-secondary">
          <input type="checkbox" checked={announcement} onChange={(event) => setAnnouncement(event.target.checked)} />
          <Megaphone className="size-3.5 text-warning" />
          {tr(fr, "Annonce générale (épinglée + notification à tous)", "General announcement (pinned + notifies everyone)")}
        </label>
      ) : null}
      <div className="flex items-end gap-2">
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          accept={accept}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            event.target.value = "";
          }}
        />
        {canImages || canDocuments ? (
          <Button
            size="icon"
            variant="ghost"
            title={
              canImages && canDocuments
                ? tr(fr, "Joindre une photo ou un document", "Attach a photo or document")
                : canImages
                  ? tr(fr, "Joindre une photo", "Attach a photo")
                  : tr(fr, "Joindre un document", "Attach a document")
            }
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip className="size-4" />
          </Button>
        ) : null}
        <textarea
          rows={1}
          value={body}
          maxLength={5000}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={tr(fr, "Écrire un message…", "Write a message…")}
          className="max-h-40 min-h-10 flex-1 resize-none rounded-xl border border-border-strong bg-surface-1 px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-ring"
        />
        <Button size="icon" loading={send.isPending} disabled={!body.trim() && !file} onClick={submit} aria-label={tr(fr, "Envoyer", "Send")}>
          <Send className="size-4" />
        </Button>
      </div>

    </div>
  );
}

function MemberPicker({ members, fr, onPick }: { members: { id: string; name: string }[]; fr: boolean; onPick: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const rows = members.filter((member) => member.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="space-y-3 p-4">
      <input
        autoFocus
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={tr(fr, "Rechercher un employé…", "Search an employee…")}
        className="h-10 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink"
      />
      <div className="max-h-80 overflow-auto">
        {rows.map((member) => (
          <button key={member.id} type="button" onClick={() => onPick(member.id)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-surface-2">
            <span className="grid size-7 place-items-center rounded-full bg-surface-3 text-[11px] font-bold text-ink-secondary">{initials(member.name)}</span>
            {member.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function AccessDialog({ orgSlug, fr, onClose }: { orgSlug: string; fr: boolean; onClose: () => void }) {
  type Member = {
    id: string;
    name: string;
    locked: boolean;
    role: string | null;
    canModerate: boolean;
    canReadDirection: boolean;
    muted: boolean;
    blocked: boolean;
    noFiles: boolean;
    canWebsite: boolean;
  };
  type Settings = {
    allowImages: boolean;
    allowDocuments: boolean;
    teamReadOnly: boolean;
    directionLabel?: string;
    websiteChatEnabled?: boolean;
    websiteAiEnabled?: boolean;
    websiteWelcome?: string | null;
    websiteKnowledge?: string | null;
  };
  const access = useQuery({
    queryKey: ["chat-access", orgSlug],
    queryFn: () => get<{ members: Member[]; settings: Settings }>(orgUrl(orgSlug, "chat/access")),
  });
  const [rows, setRows] = useState<Member[] | null>(null);
  const [rules, setRules] = useState<Settings>({ allowImages: true, allowDocuments: true, teamReadOnly: false, directionLabel: "Direction" });
  const [search, setSearch] = useState("");
  const [aiRules, setAiRules] = useState(false);
  useEffect(() => {
    if (access.data) {
      setRows(access.data.members);
      setRules(access.data.settings);
    }
  }, [access.data]);
  const save = useMutation({
    mutationFn: () =>
      put(orgUrl(orgSlug, "chat/access"), {
        // The AI knowledge text is edited in its own dialog.
        settings: { ...rules, websiteKnowledge: undefined },
        members: (rows ?? [])
          .filter((row) => row.role !== "owner")
          .map((row) => ({
            memberId: row.id,
            canModerate: row.canModerate,
            canReadDirection: row.canReadDirection,
            muted: row.muted,
            blocked: row.blocked,
            noFiles: row.noFiles,
            canWebsite: row.canWebsite,
          })),
      }),
    onSuccess: () => {
      toast.success(tr(fr, "Accès enregistrés.", "Access saved."));
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error, "")),
  });
  const toggle = (id: string, key: "canModerate" | "canReadDirection" | "muted" | "blocked" | "noFiles" | "canWebsite") =>
    setRows((current) => (current ?? []).map((row) => (row.id === id ? { ...row, [key]: !row[key] } : row)));
  return (
    <Dialog title={tr(fr, "Accès au chat", "Chat access")} onClose={onClose} wide>
      {aiRules ? <AiInstructionsDialog orgSlug={orgSlug} fr={fr} focus="website" onClose={() => setAiRules(false)} /> : null}
      <div className="space-y-3 p-5">
        <p className="text-xs leading-5 text-ink-secondary">
          {tr(
            fr,
            "Tous les employés utilisent le chat d’équipe. Choisissez qui peut modérer (épingler, supprimer, publier des annonces) et qui lit les messages privés envoyés à la direction. Le propriétaire et le directeur général ont toujours ces deux droits.",
            "Every employee uses the team chat. Choose who can moderate (pin, delete, announce) and who reads private messages sent to management. The owner and general manager always have both rights.",
          )}
        </p>
        <label className="block rounded-xl border border-border p-3">
          <span className="block text-sm font-medium text-ink">{tr(fr, "Nom affiché pour la direction", "Name shown for management")}</span>
          <span className="block text-xs text-ink-secondary">
            {tr(
              fr,
              "Les employés voient ce nom à la place du vrai nom du propriétaire, du directeur général et des personnes autorisées. La direction voit toujours les vrais noms.",
              "Employees see this name instead of the real name of the owner, general manager and authorised members. Management still sees real names.",
            )}
          </span>
          <input
            value={rules.directionLabel ?? "Direction"}
            maxLength={60}
            onChange={(event) => setRules({ ...rules, directionLabel: event.target.value })}
            className="mt-2 h-9 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink"
            placeholder="Direction"
          />
        </label>
        <div className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-3">
          {[
            { key: "allowImages" as const, label: tr(fr, "Photos autorisées", "Photos allowed"), hint: tr(fr, "Les employés peuvent envoyer des photos", "Employees can send photos") },
            { key: "allowDocuments" as const, label: tr(fr, "Documents autorisés", "Documents allowed"), hint: tr(fr, "PDF, Word, Excel…", "PDF, Word, Excel…") },
            { key: "teamReadOnly" as const, label: tr(fr, "Chat d’équipe en lecture seule", "Team chat read-only"), hint: tr(fr, "Seuls les modérateurs écrivent", "Only moderators write") },
          ].map((item) => (
            <label key={item.key} className="flex cursor-pointer items-start gap-2 rounded-lg p-1.5 text-sm hover:bg-surface-2">
              <input type="checkbox" className="mt-1" checked={rules[item.key]} onChange={(event) => setRules({ ...rules, [item.key]: event.target.checked })} />
              <span>
                <span className="block font-medium text-ink">{item.label}</span>
                <span className="block text-xs text-ink-secondary">{item.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="space-y-2 rounded-xl border border-border p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Globe2 className="size-4 text-brand" />
            {tr(fr, "Chat du site web (clients)", "Website chat (customers)")}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { key: "websiteChatEnabled" as const, label: tr(fr, "Afficher le chat sur le site", "Show chat on the website"), hint: tr(fr, "Bouton « Discuter avec nous »", "“Chat with us” button") },
              { key: "websiteAiEnabled" as const, label: tr(fr, "Réponses automatiques IA", "AI auto-replies"), hint: tr(fr, "L’IA répond, l’équipe peut reprendre la main", "AI replies, the team can take over") },
            ].map((item) => (
              <label key={item.key} className="flex cursor-pointer items-start gap-2 rounded-lg p-1.5 text-sm hover:bg-surface-2">
                <input type="checkbox" className="mt-1" checked={rules[item.key] ?? true} onChange={(event) => setRules({ ...rules, [item.key]: event.target.checked })} />
                <span>
                  <span className="block font-medium text-ink">{item.label}</span>
                  <span className="block text-xs text-ink-secondary">{item.hint}</span>
                </span>
              </label>
            ))}
          </div>
          <label className="block text-xs font-medium text-ink-secondary">
            {tr(fr, "Message d’accueil (facultatif)", "Welcome message (optional)")}
            <input
              value={rules.websiteWelcome ?? ""}
              maxLength={500}
              onChange={(event) => setRules({ ...rules, websiteWelcome: event.target.value })}
              className="mt-1 h-9 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink"
              placeholder={tr(fr, "Bonjour 👋 Comment pouvons-nous vous aider ?", "Hello 👋 How can we help?")}
            />
          </label>
          <button
            type="button"
            onClick={() => setAiRules(true)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline"
          >
            <Sparkles className="size-3.5" />
            {tr(fr, "Consignes pour l’IA (site et e-mails)…", "AI instructions (website and e-mails)…")}
          </button>
        </div>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={tr(fr, "Rechercher un employé…", "Search an employee…")}
          className="h-9 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink"
        />
        {!rows ? (
          <SkeletonCard rows={5} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <div className="min-w-[720px]">
              <div className="grid grid-cols-[1fr_repeat(6,84px)] gap-1 bg-surface-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                <span>{tr(fr, "Membre", "Member")}</span>
                <span className="text-center">{tr(fr, "Modérer", "Moderate")}</span>
                <span className="text-center">{tr(fr, "Msg privés", "Private")}</span>
                <span className="text-center text-brand">{tr(fr, "Service client", "Customer service")}</span>
                <span className="text-center">{tr(fr, "Lecture seule", "Read-only")}</span>
                <span className="text-center">{tr(fr, "Sans fichiers", "No files")}</span>
                <span className="text-center text-critical">{tr(fr, "Bloqué", "Blocked")}</span>
              </div>
              <div className="max-h-[42dvh] divide-y divide-border overflow-auto">
                {rows
                  .filter((row) => row.name.toLowerCase().includes(search.toLowerCase()))
                  .map((row) => (
                    <div key={row.id} className={`grid grid-cols-[1fr_repeat(6,84px)] items-center gap-1 px-3 py-2 text-sm ${row.blocked ? "bg-critical/[.04]" : ""}`}>
                      <span className="min-w-0 truncate text-ink">
                        {row.name}
                        {row.role ? (
                          <span className="ml-1.5 text-[11px] text-ink-muted">
                            · {row.role === "owner" ? tr(fr, "propriétaire", "owner") : tr(fr, "directeur général", "general manager")}
                          </span>
                        ) : null}
                      </span>
                      {(["canModerate", "canReadDirection", "canWebsite", "muted", "noFiles", "blocked"] as const).map((key) => (
                        <span key={key} className="text-center">
                          <input
                            type="checkbox"
                            disabled={key === "canWebsite" ? row.role === "owner" : row.locked}
                            checked={row[key]}
                            onChange={() => toggle(row.id, key)}
                            aria-label={key}
                          />
                        </span>
                      ))}
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}
        <p className="text-[11px] leading-4 text-ink-muted">
          {tr(
            fr,
            "Service client : voit l’onglet « Clients du site » et reçoit les alertes des visiteurs. Si personne n’est coché, seul le propriétaire les reçoit. Bloqué : n’a plus accès au chat d’équipe, mais peut toujours écrire à la direction en privé. Les restrictions ne s’appliquent pas aux modérateurs ni à la direction.",
            "Customer service: sees the “Website” tab and receives visitor alerts. If nobody is ticked, only the owner receives them. Blocked: no access to the team chat, but can still write privately to management. Restrictions do not apply to moderators or management.",
          )}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {tr(fr, "Annuler", "Cancel")}
          </Button>
          <Button loading={save.isPending} disabled={!rows} onClick={() => save.mutate()}>
            {tr(fr, "Enregistrer", "Save")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function LabelDialog({ orgSlug, fr, initial, onClose }: { orgSlug: string; fr: boolean; initial: string; onClose: () => void }) {
  const [label, setLabel] = useState(initial);
  const save = useMutation({
    mutationFn: () => put(orgUrl(orgSlug, "chat/direction-label"), { label: label.trim() || "Direction" }),
    onSuccess: () => {
      toast.success(tr(fr, "Nom enregistré.", "Name saved."));
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error, "")),
  });
  return (
    <Dialog title={tr(fr, "Nom affiché pour la direction", "Name shown for management")} onClose={onClose}>
      <div className="space-y-3 p-5">
        <p className="text-xs leading-5 text-ink-secondary">
          {tr(
            fr,
            "Les employés voient ce nom à la place du vrai nom de la direction dans le chat.",
            "Employees see this name instead of management's real names in the chat.",
          )}
        </p>
        <input
          autoFocus
          value={label}
          maxLength={60}
          onChange={(event) => setLabel(event.target.value)}
          className="h-10 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink"
          placeholder="Direction"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {tr(fr, "Annuler", "Cancel")}
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {tr(fr, "Enregistrer", "Save")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal>
      <div className={`flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface-1 shadow-2xl sm:max-h-[90dvh] sm:rounded-2xl ${wide ? "sm:max-w-2xl" : "sm:max-w-md"}`}>
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

/* ------------------------------------------------------------------ */
/* Website visitors (public chat on the company website)               */
/* ------------------------------------------------------------------ */

type VisitorSummary = {
  id: string;
  visitor: { name: string | null; email: string | null; phone: string | null };
  status: "open" | "closed";
  mode: "ai" | "human";
  needsHuman: boolean;
  lastMessageAt: string;
  preview: string;
  pageUrl: string | null;
  channel?: "website" | "facebook" | "instagram";
};
type VisitorThread = {
  session: {
    id: string;
    visitor: VisitorSummary["visitor"];
    status: "open" | "closed";
    mode: "ai" | "human";
    needsHuman: boolean;
    pageUrl: string | null;
    assignedToMe: boolean;
    channel?: "website" | "facebook" | "instagram";
    replyWindowEndsAt?: string | null;
  };
  messages: {
    id: string;
    from: "visitor" | "ai" | "staff" | "system";
    name: string | null;
    body: string;
    createdAt: string;
    deliveryError?: string | null;
  }[];
};
const visitorName = (visitor: VisitorSummary["visitor"], fr: boolean) =>
  visitor.name || visitor.phone || visitor.email || tr(fr, "Visiteur", "Visitor");

function VisitorList({
  orgSlug,
  fr,
  enabled,
  active,
  onSelect,
}: {
  orgSlug: string;
  fr: boolean;
  enabled: boolean;
  active: string | null;
  onSelect: (id: string) => void;
}) {
  const list = useQuery({
    queryKey: ["chat-visitors", orgSlug],
    queryFn: () => get<{ sessions: VisitorSummary[] }>(orgUrl(orgSlug, "chat/visitors")),
    refetchInterval: 8_000,
  });
  return (
    <div className="min-h-0 flex-1 overflow-auto p-2">
      {!enabled ? (
        <p className="mb-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-ink-secondary">
          {tr(fr, "Le chat est masqué sur le site (réglage ⚙️).", "The chat is hidden on the website (⚙️ settings).")}
        </p>
      ) : null}
      {list.isLoading ? (
        <SkeletonCard rows={4} />
      ) : !list.data?.sessions.length ? (
        <p className="px-3 py-3 text-xs leading-5 text-ink-secondary">
          {tr(
            fr,
            "Aucune conversation pour l’instant. Les clients écrivent depuis le site (« Discuter avec nous »), Messenger ou Instagram ; l’IA répond et vous pouvez reprendre la main ici.",
            "No conversations yet. Website visitors write through the “Chat with us” button; the AI replies and you can take over here.",
          )}
        </p>
      ) : (
        list.data.sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            onClick={() => onSelect(session.id)}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${active === session.id ? "bg-brand/10" : "hover:bg-surface-2"}`}
          >
            <span className={`grid size-9 shrink-0 place-items-center rounded-full ${session.needsHuman && session.status === "open" ? "bg-critical text-white" : "bg-surface-3 text-ink-secondary"}`}>
              <UserRound className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium text-ink">{visitorName(session.visitor, fr)}</span>
                <PlatformBadge platform={session.channel ?? "website"} />
                <span className="shrink-0 text-[10px] text-ink-muted">{time(session.lastMessageAt, fr)}</span>
              </span>
              <span className="block truncate text-xs text-ink-secondary">{session.preview || "—"}</span>
              <span className="mt-0.5 flex gap-1 text-[10px] font-semibold uppercase tracking-wide">
                {session.needsHuman && session.status === "open" ? (
                  <span className="text-critical">{tr(fr, "Attend l’équipe", "Waiting for team")}</span>
                ) : session.status === "closed" ? (
                  <span className="text-ink-muted">{tr(fr, "Terminée", "Closed")}</span>
                ) : session.mode === "human" ? (
                  <span className="text-brand">{tr(fr, "Équipe", "Team")}</span>
                ) : (
                  <span className="text-ink-muted">{tr(fr, "IA", "AI")}</span>
                )}
              </span>
            </span>
          </button>
        ))
      )}
    </div>
  );
}

function VisitorView({
  orgSlug,
  sessionId,
  fr,
  onBack,
  onActivity,
}: {
  orgSlug: string;
  sessionId: string;
  fr: boolean;
  onBack: () => void;
  onActivity: () => void;
}) {
  const queryClient = useQueryClient();
  const key = ["chat-visitor", orgSlug, sessionId];
  const thread = useQuery({
    queryKey: key,
    queryFn: () => get<VisitorThread>(orgUrl(orgSlug, `chat/visitors/${sessionId}`)),
    refetchInterval: 4_000,
  });
  const [body, setBody] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const count = thread.data?.messages.length ?? 0;
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [count]);
  const done = (data: VisitorThread) => {
    queryClient.setQueryData(key, data);
    onActivity();
  };
  const reply = useMutation({
    mutationFn: (text: string) => post<VisitorThread>(orgUrl(orgSlug, `chat/visitors/${sessionId}/messages`), { body: text }),
    onSuccess: (data) => {
      setBody("");
      done(data);
    },
    onError: (error) => toast.error(errorMessage(error, "")),
  });
  const update = useMutation({
    mutationFn: (input: { mode?: "ai" | "human"; status?: "open" | "closed" }) =>
      patch<VisitorThread>(orgUrl(orgSlug, `chat/visitors/${sessionId}`), input),
    onSuccess: done,
    onError: (error) => toast.error(errorMessage(error, "")),
  });

  if (thread.isLoading) return <div className="p-4"><SkeletonCard rows={6} /></div>;
  if (thread.isError || !thread.data)
    return (
      <div className="p-4">
        <ErrorState title={tr(fr, "Conversation indisponible", "Conversation unavailable")} description={errorMessage(thread.error, "")} onRetry={() => void thread.refetch()} />
      </div>
    );
  const { session, messages } = thread.data;
  const contact = [session.visitor.phone, session.visitor.email].filter(Boolean).join(" · ");
  const send = () => {
    const text = body.trim();
    if (text && !reply.isPending) reply.mutate(text);
  };

  return (
    <>
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 sm:px-4">
        <button type="button" onClick={onBack} className="rounded-md p-1 text-ink-secondary hover:bg-surface-2 lg:hidden" aria-label="Retour">
          <ArrowLeft className="size-5" />
        </button>
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-3 text-ink-secondary">
          <UserRound className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink">
            {visitorName(session.visitor, fr)}
            <PlatformBadge platform={session.channel ?? "website"} />
          </p>
          <p className="truncate text-xs text-ink-secondary">
            {contact || tr(fr, "Pas de contact laissé", "No contact left")}
            {session.pageUrl ? ` · ${session.pageUrl.replace(/^https?:\/\//, "")}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {session.mode === "ai" ? (
            <Button size="sm" loading={update.isPending} onClick={() => update.mutate({ mode: "human" })}>
              <UserRound className="size-4" />
              {tr(fr, "Prendre la main", "Take over")}
            </Button>
          ) : (
            <Button size="sm" variant="outline" loading={update.isPending} onClick={() => update.mutate({ mode: "ai" })}>
              <Bot className="size-4" />
              {tr(fr, "Rendre à l’IA", "Hand back to AI")}
            </Button>
          )}
          {session.status === "open" ? (
            <Button size="sm" variant="ghost" loading={update.isPending} onClick={() => update.mutate({ status: "closed" })}>
              <CheckCircle2 className="size-4" />
              {tr(fr, "Clore", "Close")}
            </Button>
          ) : null}
        </div>
      </header>
      {session.needsHuman && session.status === "open" ? (
        <p className="border-b border-border bg-critical/[.06] px-4 py-2 text-xs font-medium text-critical">
          {tr(fr, "Ce visiteur attend une réponse de l’équipe.", "This visitor is waiting for the team.")}
        </p>
      ) : null}
      <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-auto bg-surface-2/40 px-3 py-3 sm:px-4">
        {messages.map((message) =>
          message.from === "system" ? (
            <p key={message.id} className="mx-auto max-w-[90%] text-center text-xs text-ink-muted">
              {message.body}
            </p>
          ) : (
            <div key={message.id} className={message.from === "visitor" ? "flex justify-start" : "flex justify-end"}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                  message.from === "visitor"
                    ? "rounded-bl-md border border-border bg-surface-1 text-ink"
                    : message.from === "ai"
                      ? "rounded-br-md bg-surface-3 text-ink"
                      : "rounded-br-md bg-brand text-brand-ink"
                }`}
              >
                <p className={`mb-0.5 text-[10px] font-semibold uppercase tracking-wide ${message.from === "staff" ? "text-brand-ink/80" : "text-ink-muted"}`}>
                  {message.from === "visitor"
                    ? visitorName(session.visitor, fr)
                    : message.from === "ai"
                      ? tr(fr, "Assistant IA", "AI assistant")
                      : message.name || tr(fr, "Équipe", "Team")}
                  {" · "}
                  {time(message.createdAt, fr)}
                </p>
                {message.body}
                {message.deliveryError ? (
                  <span className="mt-1.5 block rounded-md bg-surface-1 px-2 py-1 text-[11px] font-semibold text-critical">
                    {tr(fr, "Non envoyé", "Not sent")} : {message.deliveryError}
                  </span>
                ) : null}
              </div>
            </div>
          ),
        )}
      </div>
      <div className="border-t border-border p-2 sm:p-3">
        {session.replyWindowEndsAt && new Date(session.replyWindowEndsAt).getTime() < Date.now() ? (
          <p className="mb-1.5 px-1 text-[11px] font-medium text-warning">
            {tr(
              fr,
              "Plus de 24 h depuis le dernier message du client : Meta bloque les réponses jusqu’à ce qu’il réécrive.",
              "More than 24 h since the customer's last message: Meta blocks replies until they write again.",
            )}
          </p>
        ) : null}
        {session.mode === "ai" ? (
          <p className="mb-1.5 px-1 text-[11px] text-ink-muted">
            {tr(fr, "L’IA répond pour l’instant. Écrire ici prend la main automatiquement.", "The AI is replying for now. Writing here takes over automatically.")}
          </p>
        ) : null}
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <textarea
            rows={2}
            value={body}
            maxLength={2000}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            placeholder={tr(fr, "Répondre au visiteur…", "Reply to the visitor…")}
            className="min-h-[44px] flex-1 resize-none rounded-xl border border-border-strong bg-surface-1 px-3 py-2 text-sm text-ink"
          />
          <Button size="icon" loading={reply.isPending} disabled={!body.trim()} type="submit" aria-label={tr(fr, "Envoyer", "Send")}>
            <Send className="size-4" />
          </Button>
        </form>
      </div>
    </>
  );
}
