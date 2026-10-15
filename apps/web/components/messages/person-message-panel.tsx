"use client";

/**
 * "Send a message" for one person — an employee from their record, or a
 * candidate from their application. The sender writes once and ticks the
 * channels; the history below shows what was sent, by whom and whether each
 * channel was delivered.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Check,
  ChevronDown,
  Mail,
  MessageSquareText,
  Send,
  Smartphone,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { get, orgUrl, post } from "@/lib/api";
import { cn } from "@/lib/utils";

type Channel = "email" | "sms" | "app";
type Delivery = Partial<Record<Channel, { sent: boolean; reason?: string }>>;
type SentMessage = {
  subject: string | null;
  body: string;
  channels: Channel[];
  delivery: Delivery;
  sentBy: string | null;
  createdAt: string;
};
type Contact = { email: string | null; phone: string | null; hasAccount?: boolean };
type MessageData = { messages?: SentMessage[]; contact?: Contact };

const tr = (fr: boolean, french: string, english: string) => (fr ? french : english);

const CHANNEL_META: Record<Channel, { icon: typeof Mail; fr: string; en: string }> = {
  email: { icon: Mail, fr: "E-mail", en: "E-mail" },
  sms: { icon: Smartphone, fr: "SMS", en: "SMS" },
  app: { icon: Bell, fr: "Notification LiteHubs", en: "LiteHubs notification" },
};

export function PersonMessagePanel({
  kind,
  orgSlug,
  personId,
  personName,
  fr,
  editable,
  className,
}: {
  kind: "employee" | "candidate";
  orgSlug: string;
  personId: string;
  personName: string;
  fr: boolean;
  editable: boolean;
  className?: string;
}) {
  const queryClient = useQueryClient();
  // Candidates share the documents query: one request returns documents,
  // messages and contact details, and both panels stay in sync.
  const key =
    kind === "employee"
      ? ["employee-messages", orgSlug, personId]
      : ["career-application-documents", orgSlug, personId];
  const listPath =
    kind === "employee"
      ? `employees/${personId}/messages`
      : `careers/applications/${personId}/documents`;
  const sendPath =
    kind === "employee"
      ? `employees/${personId}/messages`
      : `careers/applications/${personId}/messages`;
  const data = useQuery({
    queryKey: key,
    queryFn: () => get<MessageData>(orgUrl(orgSlug, listPath)),
  });
  const contact = data.data?.contact;
  const messages = data.data?.messages ?? [];
  const available: Channel[] = kind === "employee" ? ["email", "sms", "app"] : ["email", "sms"];
  const reachable = (channel: Channel) =>
    channel === "email"
      ? Boolean(contact?.email)
      : channel === "sms"
        ? Boolean(contact?.phone)
        : Boolean(contact?.hasAccount);

  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [picked, setPicked] = useState<Channel[] | null>(null);
  const defaults = available.filter(reachable);
  const channels = (picked ?? defaults).filter(reachable);

  const send = useMutation({
    mutationFn: () =>
      post<MessageData & { delivery: Delivery }>(orgUrl(orgSlug, sendPath), {
        subject: subject.trim() || undefined,
        body: body.trim(),
        channels,
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(key, (current: MessageData | undefined) => ({ ...(current ?? {}), ...next }));
      setSubject("");
      setBody("");
      setPicked(null);
      setOpen(false);
      const failed = Object.entries(next.delivery ?? {}).filter(([, value]) => value && !value.sent);
      if (failed.length)
        toast.warning(
          tr(
            fr,
            `Message enregistré, mais non délivré par : ${failed.map(([channel]) => CHANNEL_META[channel as Channel].fr).join(", ")}.`,
            `Message saved, but not delivered by: ${failed.map(([channel]) => CHANNEL_META[channel as Channel].en).join(", ")}.`,
          ),
        );
      else toast.success(tr(fr, `Message envoyé à ${personName}.`, `Message sent to ${personName}.`));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const when = (value: string) =>
    new Date(value).toLocaleString(fr ? "fr-FR" : "en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <section className={cn("rounded-2xl border border-border bg-surface-1 p-4 sm:p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand dark:bg-brand/20 dark:text-brand-active">
            <MessageSquareText className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink">{tr(fr, "Messages", "Messages")}</h3>
            <p className="mt-0.5 text-xs leading-5 text-ink-secondary">
              {messages.length
                ? tr(fr, `${messages.length} message(s) envoyé(s)`, `${messages.length} message(s) sent`)
                : kind === "employee"
                  ? tr(fr, "Écrivez directement à cet employé.", "Write directly to this employee.")
                  : tr(fr, "Écrivez directement à ce candidat.", "Write directly to this candidate.")}
            </p>
          </div>
        </div>
        {editable ? (
          <Button size="sm" onClick={() => setOpen(!open)} disabled={data.isLoading}>
            <Send className="size-3.5" />
            {tr(fr, "Envoyer un message", "Send a message")}
          </Button>
        ) : null}
      </div>

      {open && editable ? (
        <div className="mt-4 space-y-3 rounded-xl border border-brand/20 bg-brand/[.03] p-4">
          <Field label={tr(fr, "Objet (facultatif)", "Subject (optional)")}>
            <Input
              value={subject}
              maxLength={160}
              placeholder={tr(fr, "Ex. Réunion de demain", "e.g. Tomorrow’s meeting")}
              onChange={(event) => setSubject(event.target.value)}
            />
          </Field>
          <Field label={tr(fr, "Message", "Message")}>
            <Textarea
              rows={4}
              maxLength={2000}
              value={body}
              placeholder={tr(fr, `Bonjour ${personName.split(" ")[0] ?? ""}, …`, `Hello ${personName.split(" ")[0] ?? ""}, …`)}
              onChange={(event) => setBody(event.target.value)}
            />
          </Field>
          <div>
            <p className="text-xs font-semibold text-ink">{tr(fr, "Envoyer par", "Send by")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {available.map((channel) => {
                const meta = CHANNEL_META[channel];
                const Icon = meta.icon;
                const ok = reachable(channel);
                const active = channels.includes(channel);
                const detail =
                  channel === "email" ? contact?.email : channel === "sms" ? contact?.phone : null;
                return (
                  <button
                    key={channel}
                    type="button"
                    disabled={!ok}
                    title={
                      ok
                        ? detail ?? undefined
                        : channel === "email"
                          ? tr(fr, "Aucune adresse e-mail", "No e-mail address")
                          : channel === "sms"
                            ? tr(fr, "Aucun numéro de téléphone", "No phone number")
                            : tr(fr, "Pas encore de compte LiteHubs", "No LiteHubs account yet")
                    }
                    onClick={() =>
                      setPicked(active ? channels.filter((item) => item !== channel) : [...channels, channel])
                    }
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                      !ok && "cursor-not-allowed opacity-45",
                      active
                        ? "border-brand bg-brand text-brand-ink"
                        : "border-border bg-surface-1 text-ink hover:border-brand/40",
                    )}
                  >
                    {active ? <Check className="size-3" /> : <Icon className="size-3" />}
                    {fr ? meta.fr : meta.en}
                    {detail ? <span className={cn("max-w-40 truncate", active ? "opacity-80" : "text-ink-muted")}>· {detail}</span> : null}
                  </button>
                );
              })}
            </div>
            {channels.includes("sms") ? (
              <p className="mt-2 text-[11px] text-ink-muted">
                {tr(
                  fr,
                  "Le SMS reprend le texte du message (gardez-le court).",
                  "The SMS carries the message text (keep it short).",
                )}
                {kind === "candidate"
                  ? tr(fr, " Le lien vers l’Espace candidat est ajouté automatiquement.", " The candidate-space link is added automatically.")
                  : ""}
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {tr(fr, "Annuler", "Cancel")}
            </Button>
            <Button
              loading={send.isPending}
              disabled={!body.trim() || !channels.length}
              onClick={() => send.mutate()}
            >
              <Send className="size-4" />
              {tr(fr, "Envoyer", "Send")}
            </Button>
          </div>
        </div>
      ) : null}

      {messages.length ? (
        <details className="group mt-4" open={messages.length <= 3}>
          <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-semibold text-ink-secondary hover:text-ink">
            <ChevronDown className="size-3.5 transition group-open:rotate-180" />
            {tr(fr, "Historique des messages", "Message history")}
          </summary>
          <ul className="mt-2 space-y-2">
            {messages.map((message, index) => (
              <li key={`${message.createdAt}-${index}`} className="rounded-xl border border-border/80 bg-surface-2/35 p-3">
                {message.subject ? <p className="text-sm font-semibold text-ink">{message.subject}</p> : null}
                <p className="whitespace-pre-line text-sm leading-6 text-ink-secondary">{message.body}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
                  <span>
                    {when(message.createdAt)}
                    {message.sentBy ? ` · ${message.sentBy}` : ""}
                  </span>
                  {message.channels.map((channel) => {
                    const result = message.delivery?.[channel];
                    const failed = result && !result.sent;
                    const Icon = CHANNEL_META[channel]?.icon ?? Mail;
                    return (
                      <span
                        key={channel}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium",
                          failed ? "bg-critical/10 text-critical" : "bg-good/10 text-good-ink",
                        )}
                        title={failed ? result?.reason : undefined}
                      >
                        {failed ? <TriangleAlert className="size-3" /> : <Icon className="size-3" />}
                        {fr ? CHANNEL_META[channel]?.fr : CHANNEL_META[channel]?.en}
                        {failed ? ` · ${tr(fr, "non délivré", "not delivered")}` : ""}
                      </span>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
