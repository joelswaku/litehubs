"use client";
/**
 * Acknowledgement of the company rules.
 *  - RulesAcknowledgementPanel (HR / owner): who signed the current version,
 *    reminders, copy to print, paper scan recording, signed copies.
 *  - MyRulesCard (employee, My account): read the rules and sign.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CheckCircle2, Clock3, Eye, FileSignature, PenLine, Printer, ScrollText, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ApiError, get, orgApiUrl, orgUrl, post } from "@/lib/api";

type Ack = { id: string; method: "electronic" | "paper"; signedName: string; signedAt: string; recordedBy: string | null; note: string | null };
type Overview = {
  version: { id: string; number: number; title: string; publishedAt: string } | null;
  employees: { id: string; name: string; employeeNumber: string | null; jobTitle: string | null; hasAccount: boolean; acknowledgement: Ack | null }[];
  summary: { total: number; signed: number; electronic: number; paper: number; pending: number };
};
type Mine = {
  version: { id: string; number: number; title: string; content: string; publishedAt: string } | null;
  employee: { id: string; name: string } | null;
  acknowledgement: Ack | null;
  consentText?: string;
};

const tr = (fr: boolean, french: string, english: string) => (fr ? french : english);
const failed = (error: unknown, fr: boolean) =>
  error instanceof ApiError ? error.message : tr(fr, "L’action a échoué. Réessayez.", "The action failed. Try again.");
const day = (value: string, fr: boolean) =>
  new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", { dateStyle: "medium" }).format(new Date(value));
const today = () => new Date().toLocaleDateString("en-CA");

function MethodBadge({ ack, fr }: { ack: Ack; fr: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-good/12 px-2 py-0.5 text-[11px] font-semibold text-good">
      <CheckCircle2 className="size-3" />
      {ack.method === "paper" ? tr(fr, "Signé sur papier", "Signed on paper") : tr(fr, "Signé dans LiteHubs", "Signed in LiteHubs")} · {day(ack.signedAt, fr)}
    </span>
  );
}

function PaperForm({ orgSlug, fr, employeeId, onDone, onCancel }: { orgSlug: string; fr: boolean; employeeId: string; onDone: (data: Overview) => void; onCancel: () => void }) {
  const [signedOn, setSignedOn] = useState(today());
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.append("file", file!);
      body.append("signedOn", signedOn);
      if (note.trim()) body.append("note", note.trim());
      return post<Overview>(orgUrl(orgSlug, `company-rules/acknowledgements/paper/${employeeId}`), body, { headers: { "Content-Type": "multipart/form-data" } });
    },
    onSuccess: (data) => {
      onDone(data);
      toast.success(tr(fr, "Copie signée enregistrée.", "Signed copy recorded."));
    },
    onError: (error) => toast.error(failed(error, fr)),
  });
  return (
    <div className="mt-3 grid gap-2 rounded-xl border border-border bg-surface-2/50 p-3 sm:grid-cols-[auto_1fr]">
      <label className="text-xs font-semibold text-ink-secondary">
        {tr(fr, "Signé le", "Signed on")}
        <input type="date" value={signedOn} max={today()} onChange={(event) => setSignedOn(event.target.value)} className="mt-1 block h-9 rounded-lg border border-border-strong bg-surface-1 px-2 text-sm text-ink" />
      </label>
      <label className="text-xs font-semibold text-ink-secondary">
        {tr(fr, "Scan ou photo de la page signée (PDF, JPG, PNG)", "Scan or photo of the signed page (PDF, JPG, PNG)")}
        <input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-brand/10 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-brand" />
      </label>
      <input value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder={tr(fr, "Note (facultatif)", "Note (optional)")} className="h-9 rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink sm:col-span-2" />
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>{tr(fr, "Annuler", "Cancel")}</Button>
        <Button size="sm" loading={save.isPending} disabled={!file || !signedOn} onClick={() => save.mutate()}>
          <Upload className="size-4" />
          {tr(fr, "Enregistrer la copie signée", "Record signed copy")}
        </Button>
      </div>
    </div>
  );
}

export function RulesAcknowledgementPanel({ orgSlug, fr }: { orgSlug: string; fr: boolean }) {
  const client = useQueryClient();
  const key = ["company-rules-acks", orgSlug];
  const overview = useQuery({ queryKey: key, queryFn: () => get<Overview>(orgUrl(orgSlug, "company-rules/acknowledgements")) });
  const [paperFor, setPaperFor] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "signed">("all");
  const remind = useMutation({
    mutationFn: (employeeIds: string[] | "pending") => post<{ notified: number }>(orgUrl(orgSlug, "company-rules/acknowledgements/remind"), { employeeIds }),
    onSuccess: (data) =>
      toast.success(
        data.notified
          ? tr(fr, `${data.notified} employé(s) notifié(s) dans leur compte.`, `${data.notified} employee(s) notified.`)
          : tr(fr, "Aucun employé à notifier (déjà signé ou sans compte LiteHubs).", "Nobody to notify."),
      ),
    onError: (error) => toast.error(failed(error, fr)),
  });
  const data = overview.data;
  if (overview.isLoading) return <div className="h-40 animate-pulse rounded-2xl bg-surface-2" />;
  if (overview.isError) return null;
  if (!data?.version)
    return (
      <section className="rounded-2xl border border-border bg-surface-1 p-5 text-sm text-ink-secondary">
        <p className="font-semibold text-ink">{tr(fr, "Signatures du règlement", "Rules signatures")}</p>
        <p className="mt-1">{tr(fr, "Publiez une première version du règlement : chaque employé pourra ensuite la lire et la signer.", "Publish a first version: each employee can then read and sign it.")}</p>
      </section>
    );
  const { summary } = data;
  const percent = summary.total ? Math.round((summary.signed / summary.total) * 100) : 0;
  const rows = data.employees.filter((item) => (filter === "all" ? true : filter === "pending" ? !item.acknowledgement : Boolean(item.acknowledgement)));
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-[linear-gradient(115deg,color-mix(in_srgb,var(--brand)_9%,transparent),transparent_55%)] p-5">
        <div>
          <p className="flex items-center gap-2 font-semibold text-ink">
            <FileSignature className="size-4 text-brand" />
            {tr(fr, "Signatures du règlement", "Rules signatures")} · v{data.version.number}
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-secondary">
            {tr(
              fr,
              "Chaque employé confirme avoir reçu, lu et compris cette version : dans son compte LiteHubs, ou sur papier (imprimez, faites signer, puis enregistrez le scan).",
              "Each employee confirms receiving, reading and understanding this version: in LiteHubs, or on paper (print, sign, then record the scan).",
            )}
          </p>
        </div>
        {summary.pending ? (
          <Button size="sm" variant="secondary" loading={remind.isPending && remind.variables === "pending"} onClick={() => remind.mutate("pending")}>
            <BellRing className="size-4" />
            {tr(fr, "Demander la signature à tous", "Ask everyone to sign")}
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 p-5 sm:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="rounded-xl border border-border p-3">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-semibold text-ink-secondary">{tr(fr, "Progression", "Progress")}</p>
            <p className="text-lg font-semibold text-ink">{percent}%</p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-1.5 text-[11px] text-ink-muted">{summary.signed} / {summary.total} {tr(fr, "employés actifs", "active employees")}</p>
        </div>
        {(
          [
            [tr(fr, "Dans LiteHubs", "In LiteHubs"), summary.electronic, PenLine],
            [tr(fr, "Sur papier", "On paper"), summary.paper, Printer],
            [tr(fr, "En attente", "Pending"), summary.pending, Clock3],
          ] as const
        ).map(([label, value, Icon]) => (
          <div key={label} className="rounded-xl border border-border p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-secondary"><Icon className="size-3.5" />{label}</p>
            <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-1 px-5">
        {(["all", "pending", "signed"] as const).map((item) => (
          <button key={item} type="button" onClick={() => setFilter(item)} className={`rounded-full px-3 py-1 text-xs font-semibold transition ${filter === item ? "bg-brand text-brand-ink" : "text-ink-secondary hover:bg-surface-2"}`}>
            {item === "all" ? tr(fr, "Tous", "All") : item === "pending" ? tr(fr, "À signer", "To sign") : tr(fr, "Signés", "Signed")}
          </button>
        ))}
      </div>
      <ul className="mt-3 divide-y divide-border border-t border-border">
        {rows.map((item) => (
          <li key={item.id} className="px-5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{item.name}</p>
                <p className="text-xs text-ink-secondary">
                  {[item.employeeNumber ? `#${item.employeeNumber}` : null, item.jobTitle].filter(Boolean).join(" · ") || "—"}
                  {!item.hasAccount ? ` · ${tr(fr, "sans compte LiteHubs (signature papier)", "no LiteHubs account (paper)")}` : ""}
                </p>
                <div className="mt-1">
                  {item.acknowledgement ? (
                    <MethodBadge ack={item.acknowledgement} fr={fr} />
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning/12 px-2 py-0.5 text-[11px] font-semibold text-warning"><Clock3 className="size-3" />{tr(fr, "Pas encore signé", "Not signed yet")}</span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {item.acknowledgement ? (
                  <a href={orgApiUrl(orgSlug, `company-rules/acknowledgements/${item.acknowledgement.id}/document`)} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-ink hover:bg-surface-2">
                    <Eye className="size-3.5" />{tr(fr, "Copie signée", "Signed copy")}
                  </a>
                ) : (
                  <>
                    {item.hasAccount ? (
                      <Button size="sm" variant="ghost" loading={remind.isPending && Array.isArray(remind.variables) && remind.variables[0] === item.id} onClick={() => remind.mutate([item.id])}>
                        <BellRing className="size-3.5" />{tr(fr, "Rappeler", "Remind")}
                      </Button>
                    ) : null}
                    <a href={orgApiUrl(orgSlug, `company-rules/acknowledgements/print/${item.id}`)} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-ink hover:bg-surface-2">
                      <Printer className="size-3.5" />{tr(fr, "Imprimer à signer", "Print to sign")}
                    </a>
                    <Button size="sm" variant="secondary" onClick={() => setPaperFor(paperFor === item.id ? null : item.id)}>
                      <Upload className="size-3.5" />{tr(fr, "Copie papier signée", "Paper copy signed")}
                    </Button>
                  </>
                )}
              </div>
            </div>
            {paperFor === item.id ? (
              <PaperForm
                orgSlug={orgSlug}
                fr={fr}
                employeeId={item.id}
                onCancel={() => setPaperFor(null)}
                onDone={(next) => {
                  client.setQueryData(key, next);
                  setPaperFor(null);
                }}
              />
            ) : null}
          </li>
        ))}
        {!rows.length ? <li className="px-5 py-6 text-center text-sm text-ink-muted">{tr(fr, "Personne dans cette liste.", "Nobody here.")}</li> : null}
      </ul>
    </section>
  );
}

/** Rules text with numbered chapters (« 1. Title ») shown as headings. */
function RulesText({ content }: { content: string }) {
  return (
    <div className="space-y-2 text-sm leading-7 text-ink-secondary">
      {content.split(/\r?\n/).map((raw, index) => {
        const line = raw.trim();
        if (!line) return <div key={index} className="h-1" />;
        if (/^\d+\.\s/.test(line))
          return <h3 key={index} className="pt-3 text-base font-semibold text-ink">{line}</h3>;
        return <p key={index}>{line}</p>;
      })}
    </div>
  );
}

export function MyRulesCard({ orgSlug, fr }: { orgSlug: string; fr: boolean }) {
  const client = useQueryClient();
  const key = ["my-company-rules", orgSlug];
  const mine = useQuery({ queryKey: key, queryFn: () => get<Mine>(orgUrl(orgSlug, "company-rules/my-acknowledgement")) });
  const [open, setOpen] = useState(false);
  const [readToEnd, setReadToEnd] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [name, setName] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("rules") === "1") setOpen(true);
  }, []);
  const sign = useMutation({
    mutationFn: () => post<Mine>(orgUrl(orgSlug, "company-rules/my-acknowledgement"), { versionId: mine.data!.version!.id, signedName: name, accepted: true }),
    onSuccess: (data) => {
      client.setQueryData(key, data);
      toast.success(tr(fr, "Merci ! Votre signature est enregistrée.", "Thank you! Your signature is recorded."));
      setOpen(false);
    },
    onError: (error) => toast.error(failed(error, fr)),
  });
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      const node = scroller.current;
      if (node && node.scrollHeight <= node.clientHeight + 40) setReadToEnd(true);
    }, 50);
    return () => window.clearTimeout(timer);
  }, [open]);
  const data = mine.data;
  if (!data?.version || !data.employee) return null;
  const ack = data.acknowledgement;
  return (
    <>
      <section className={`overflow-hidden rounded-2xl border p-4 shadow-sm sm:p-5 ${ack ? "border-border bg-surface-1" : "border-warning/40 bg-[linear-gradient(120deg,color-mix(in_srgb,var(--warning)_10%,transparent),transparent_60%),var(--surface-1)]"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${ack ? "bg-good/12 text-good" : "bg-warning/15 text-warning"}`}>
              {ack ? <CheckCircle2 className="size-5" /> : <ScrollText className="size-5" />}
            </span>
            <div>
              <p className="font-semibold text-ink">{tr(fr, "Règlement de l’entreprise", "Company rules")} · v{data.version.number}</p>
              <p className="mt-0.5 text-xs text-ink-secondary">
                {ack ? <MethodBadge ack={ack} fr={fr} /> : tr(fr, "À lire et signer : confirmez que vous l’avez reçu et compris.", "To read and sign: confirm you received and understood it.")}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {ack ? (
              <a href={orgApiUrl(orgSlug, `company-rules/acknowledgements/${ack.id}/document`)} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-semibold text-ink hover:bg-surface-2">
                <Eye className="size-4" />{tr(fr, "Ma copie signée", "My signed copy")}
              </a>
            ) : null}
            <Button size="sm" variant={ack ? "ghost" : "primary"} onClick={() => setOpen(true)}>
              <ScrollText className="size-4" />
              {ack ? tr(fr, "Relire", "Read again") : tr(fr, "Lire et signer", "Read and sign")}
            </Button>
          </div>
        </div>
      </section>
      {open ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true">
          <div className="flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl border border-border bg-surface-1 shadow-2xl sm:rounded-3xl">
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.14em] text-brand">{tr(fr, "Version", "Version")} {data.version.number} · {day(data.version.publishedAt, fr)}</p>
                <h2 className="mt-1 text-lg font-semibold text-ink">{data.version.title}</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-ink-secondary hover:bg-surface-3" aria-label={tr(fr, "Fermer", "Close")}><X className="size-5" /></button>
            </div>
            <div
              ref={scroller}
              onScroll={(event) => {
                const node = event.currentTarget;
                if (node.scrollTop + node.clientHeight >= node.scrollHeight - 40) setReadToEnd(true);
              }}
              className="flex-1 overflow-y-auto px-5 py-4 sm:px-7"
            >
              <RulesText content={data.version.content} />
              <div className="h-4" />
            </div>
            {ack ? (
              <div className="border-t border-border px-5 py-4"><MethodBadge ack={ack} fr={fr} /></div>
            ) : (
              <div className="space-y-3 border-t border-border bg-surface-2/50 px-5 py-4">
                {!readToEnd ? <p className="text-xs text-ink-muted">{tr(fr, "Faites défiler jusqu’à la fin du règlement pour pouvoir signer.", "Scroll to the end of the rules to sign.")}</p> : null}
                <label className={`flex items-start gap-2 text-sm text-ink ${readToEnd ? "" : "opacity-50"}`}>
                  <input type="checkbox" className="mt-1 size-4 accent-brand" disabled={!readToEnd} checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
                  {data.consentText ?? tr(fr, "J’ai reçu, lu et compris le règlement et je m’engage à le respecter.", "I received, read and understood the rules.")}
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    disabled={!accepted}
                    placeholder={tr(fr, `Écrivez votre nom : ${data.employee.name}`, `Type your name: ${data.employee.name}`)}
                    className="h-10 min-w-0 flex-1 rounded-lg border border-border-strong bg-surface-1 px-3 font-serif text-base italic text-ink disabled:opacity-50"
                  />
                  <Button loading={sign.isPending} disabled={!accepted || name.trim().length < 3} onClick={() => sign.mutate()}>
                    <PenLine className="size-4" />
                    {tr(fr, "Signer", "Sign")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
