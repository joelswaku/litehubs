"use client";

import * as React from "react";
import { MessageCircle, Send, UserRound, X } from "lucide-react";
import { get, post } from "@/lib/api";

type Info =
  | { enabled: false }
  | { enabled: true; organizationName: string; welcome: string; assistant: boolean };
type ChatMessage = {
  id: string;
  from: "visitor" | "team" | "assistant" | "system";
  name: string | null;
  body: string;
  createdAt: string;
};
type Thread = {
  session: { status: string; mode: "ai" | "human"; needsHuman: boolean; organizationName: string };
  messages: ChatMessage[];
};

const storageKey = (site: string) => `litehubs-website-chat:${site}`;
function readToken(site: string) {
  try {
    return window.localStorage.getItem(storageKey(site));
  } catch {
    return null;
  }
}
function writeToken(site: string, token: string | null) {
  try {
    if (token) window.localStorage.setItem(storageKey(site), token);
    else window.localStorage.removeItem(storageKey(site));
  } catch {
    /* private browsing: the conversation lasts as long as the page */
  }
}

const copy = {
  fr: {
    open: "Discuter avec nous",
    title: "Une question ?",
    subtitle: (assistant: boolean) =>
      assistant ? "Assistant en ligne · l’équipe peut aussi répondre" : "L’équipe vous répond ici",
    placeholder: "Écrivez votre message…",
    human: "Parler à l’équipe",
    humanTitle: "Comment vous recontacter ?",
    humanHint: "Laissez au moins un téléphone ou un e-mail si vous quittez la page.",
    name: "Votre nom",
    phone: "Téléphone / WhatsApp",
    email: "E-mail",
    confirm: "Prévenir l’équipe",
    cancel: "Annuler",
    team: "Équipe",
    assistant: "Assistant",
    typing: "Rédaction de la réponse…",
    error: "Message non envoyé. Réessayez.",
    waiting: "L’équipe a été prévenue.",
    closed: "Conversation terminée. Elle sera effacée quand vous fermerez le chat. Vous pouvez encore écrire ici ou",
    restart: "en commencer une nouvelle",
  },
  en: {
    open: "Chat with us",
    title: "Any questions?",
    subtitle: (assistant: boolean) =>
      assistant ? "Assistant online · our team can reply too" : "Our team replies here",
    placeholder: "Type your message…",
    human: "Talk to the team",
    humanTitle: "How can we reach you?",
    humanHint: "Leave at least a phone number or an email if you leave the page.",
    name: "Your name",
    phone: "Phone / WhatsApp",
    email: "Email",
    confirm: "Notify the team",
    cancel: "Cancel",
    team: "Team",
    assistant: "Assistant",
    typing: "Writing a reply…",
    error: "Message not sent. Please try again.",
    waiting: "The team has been notified.",
    closed: "Conversation closed. It will be cleared when you close the chat. You can still write here or",
    restart: "start a new one",
  },
};

/** Floating chat bubble on the public website.  Visitors ask questions, the
 * AI assistant answers from the published site and offers, and the team can
 * take over from LiteHubs (Chat → Clients du site). */
export function WebsiteChatWidget({
  site,
  language,
  color,
}: {
  site: string;
  language: "fr" | "en";
  color: string;
}) {
  const t = copy[language] ?? copy.fr;
  const [info, setInfo] = React.useState<Info | null>(null);
  const [open, setOpen] = React.useState(false);
  const [token, setToken] = React.useState<string | null>(null);
  const [thread, setThread] = React.useState<Thread | null>(null);
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [askHuman, setAskHuman] = React.useState(false);
  const [contact, setContact] = React.useState({ name: "", phone: "", email: "" });
  const [seen, setSeen] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);
  const openRef = React.useRef(false);
  openRef.current = open;
  const base = `/public/website-chat/${encodeURIComponent(site)}`;

  React.useEffect(() => {
    let alive = true;
    get<Info>(base)
      .then((data) => alive && setInfo(data))
      .catch(() => alive && setInfo({ enabled: false }));
    setToken(readToken(site));
    return () => {
      alive = false;
    };
  }, [base, site]);

  const refresh = React.useCallback(
    async (current: string) => {
      try {
        const data = await get<Thread>(`${base}/sessions/${current}/messages`);
        // A finished conversation is cleared from the visitor's browser once
        // they are not looking at it (the team keeps the full history).
        if (data.session.status === "closed" && !openRef.current) {
          writeToken(site, null);
          setToken(null);
          setThread(null);
          return;
        }
        setThread(data);
      } catch (cause) {
        // Unknown or expired conversation: start a new one next time.
        if ((cause as { status?: number })?.status === 404 || (cause as { status?: number })?.status === 400) {
          writeToken(site, null);
          setToken(null);
          setThread(null);
        }
      }
    },
    [base, site],
  );

  // Poll quickly while open, slowly while closed (to show a dot on new replies).
  React.useEffect(() => {
    if (!token) return;
    void refresh(token);
    const timer = window.setInterval(() => void refresh(token), open ? 4_000 : 30_000);
    return () => window.clearInterval(timer);
  }, [token, open, refresh]);

  const incoming = thread?.messages.filter((m) => m.from === "team" || m.from === "assistant").length ?? 0;
  React.useEffect(() => {
    if (open) setSeen(incoming);
  }, [open, incoming]);
  React.useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [thread?.messages.length, open, sending]);

  if (!info || !info.enabled) return null;

  const ensureToken = async () => {
    if (token) return token;
    const created = await post<{ token: string }>(`${base}/sessions`, {
      pageUrl: typeof window !== "undefined" ? window.location.href.slice(0, 500) : undefined,
    });
    writeToken(site, created.token);
    setToken(created.token);
    return created.token;
  };

  const send = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    setDraft("");
    // Show the visitor's message straight away.
    setThread((current) => ({
      session: current?.session ?? { status: "open", mode: "ai", needsHuman: false, organizationName: info.organizationName },
      messages: [
        ...(current?.messages ?? [{ id: "welcome", from: "system", name: null, body: info.welcome, createdAt: "" }]),
        { id: `local-${Date.now()}`, from: "visitor", name: null, body, createdAt: new Date().toISOString() },
      ],
    }));
    try {
      const current = await ensureToken();
      setThread(await post<Thread>(`${base}/sessions/${current}/messages`, { body }));
    } catch {
      setError(t.error);
      setDraft(body);
      if (token) void refresh(token);
    } finally {
      setSending(false);
    }
  };

  const requestHuman = async (event: React.FormEvent) => {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      const current = await ensureToken();
      setThread(
        await post<Thread>(`${base}/sessions/${current}/human`, {
          name: contact.name || undefined,
          phone: contact.phone || undefined,
          email: contact.email || undefined,
        }),
      );
      setAskHuman(false);
    } catch {
      setError(t.error);
    } finally {
      setSending(false);
    }
  };

  const messages: ChatMessage[] =
    thread?.messages ?? [{ id: "welcome", from: "system", name: null, body: info.welcome, createdAt: "" }];
  const unread = !open && incoming > seen;
  const closed = thread?.session.status === "closed";
  const showHumanButton = !closed && !thread?.session.needsHuman && thread?.session.mode !== "human";
  const restart = () => {
    writeToken(site, null);
    setToken(null);
    setThread(null);
    setError(null);
  };
  const closeWidget = () => {
    setOpen(false);
    if (closed) restart();
  };
  const thinking = sending && info.assistant && (thread?.session.mode ?? "ai") === "ai" && !askHuman;

  return (
    <div className="lh-webchat fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-3 font-sans text-[15px] sm:bottom-6 sm:right-6">
      {open ? (
        <section
          aria-label={t.title}
          className="flex h-[min(560px,calc(100dvh-6rem))] w-[calc(100vw-2rem)] max-w-[380px] flex-col overflow-hidden rounded-2xl border border-black/10 bg-white text-slate-900 shadow-2xl"
        >
          <header className="flex items-start gap-3 px-4 py-3 text-white" style={{ background: color }}>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{info.organizationName}</p>
              <p className="text-xs text-white/85">{t.subtitle(info.assistant)}</p>
            </div>
            <button
              type="button"
              onClick={closeWidget}
              aria-label="Fermer"
              className="rounded-full p-1 text-white/90 transition hover:bg-white/15"
            >
              <X className="size-5" />
            </button>
          </header>

          <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto bg-slate-50 px-3 py-3">
            {messages.map((message) =>
              message.from === "system" ? (
                <p key={message.id} className="mx-auto max-w-[90%] rounded-xl bg-white px-3 py-2 text-center text-[13px] text-slate-600 shadow-sm">
                  {message.body}
                </p>
              ) : (
                <div key={message.id} className={message.from === "visitor" ? "flex justify-end" : "flex justify-start"}>
                  <div
                    className={
                      message.from === "visitor"
                        ? "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md px-3 py-2 text-white"
                        : "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-md border border-black/5 bg-white px-3 py-2 shadow-sm"
                    }
                    style={message.from === "visitor" ? { background: color } : undefined}
                  >
                    {message.from !== "visitor" ? (
                      <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {message.from === "team" ? message.name || t.team : t.assistant}
                      </p>
                    ) : null}
                    {message.body}
                  </div>
                </div>
              ),
            )}
            {thinking ? <p className="px-1 text-xs italic text-slate-500">{t.typing}</p> : null}
          </div>

          {askHuman ? (
            <form onSubmit={requestHuman} className="space-y-2 border-t border-black/10 bg-white p-3">
              <p className="text-sm font-semibold">{t.humanTitle}</p>
              <p className="text-xs text-slate-500">{t.humanHint}</p>
              <input
                className="w-full rounded-lg border border-black/15 px-3 py-2 text-base outline-none focus:border-black/40"
                placeholder={t.name}
                maxLength={120}
                value={contact.name}
                onChange={(event) => setContact({ ...contact, name: event.target.value })}
              />
              <input
                className="w-full rounded-lg border border-black/15 px-3 py-2 text-base outline-none focus:border-black/40"
                placeholder={t.phone}
                inputMode="tel"
                maxLength={40}
                value={contact.phone}
                onChange={(event) => setContact({ ...contact, phone: event.target.value })}
              />
              <input
                className="w-full rounded-lg border border-black/15 px-3 py-2 text-base outline-none focus:border-black/40"
                placeholder={t.email}
                type="email"
                maxLength={200}
                value={contact.email}
                onChange={(event) => setContact({ ...contact, email: event.target.value })}
              />
              {error ? <p className="text-xs text-red-600">{error}</p> : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAskHuman(false)}
                  className="flex-1 rounded-lg border border-black/15 px-3 py-2 text-sm"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  disabled={sending}
                  className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  style={{ background: color }}
                >
                  {t.confirm}
                </button>
              </div>
            </form>
          ) : (
            <div className="border-t border-black/10 bg-white p-2">
              {closed ? (
                <p className="mb-2 px-1 text-xs text-slate-500">
                  {t.closed}{" "}
                  <button type="button" onClick={restart} className="font-semibold underline" style={{ color }}>
                    {t.restart}
                  </button>
                  .
                </p>
              ) : showHumanButton ? (
                <button
                  type="button"
                  onClick={() => setAskHuman(true)}
                  className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-black/10 px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  <UserRound className="size-3.5" />
                  {t.human}
                </button>
              ) : thread?.session.needsHuman ? (
                <p className="mb-2 px-1 text-xs text-slate-500">{t.waiting}</p>
              ) : null}
              {error ? <p className="mb-1 px-1 text-xs text-red-600">{error}</p> : null}
              <form onSubmit={send} className="flex items-end gap-2">
                <textarea
                  rows={1}
                  maxLength={2000}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  placeholder={t.placeholder}
                  aria-label={t.placeholder}
                  className="max-h-28 min-h-[40px] flex-1 resize-none rounded-xl border border-black/15 px-3 py-2 text-base outline-none focus:border-black/40"
                />
                <button
                  type="submit"
                  disabled={sending || !draft.trim()}
                  aria-label="Envoyer"
                  className="grid size-10 shrink-0 place-items-center rounded-xl text-white disabled:opacity-50"
                  style={{ background: color }}
                >
                  <Send className="size-4" />
                </button>
              </form>
            </div>
          )}
        </section>
      ) : null}

      <button
        type="button"
        onClick={() => (open ? closeWidget() : setOpen(true))}
        aria-label={open ? "Fermer" : t.open}
        className="relative inline-flex items-center gap-2 rounded-full px-4 py-3 font-semibold text-white shadow-xl transition hover:brightness-110"
        style={{ background: color }}
      >
        {open ? <X className="size-5" /> : <MessageCircle className="size-5" />}
        {!open ? <span className="hidden sm:inline">{t.open}</span> : null}
        {unread ? <span className="absolute -right-0.5 -top-0.5 size-3.5 rounded-full border-2 border-white bg-red-500" /> : null}
      </button>
    </div>
  );
}
