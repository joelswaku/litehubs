"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Eye,
  FileDown,
  FilePlus2,
  Link2,
  Plus,
  Send,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { SkeletonCard } from "@/components/ui/states";
import { api, get, orgUrl, patch, post } from "@/lib/api";

type DocumentRequest = {
  id: string;
  label: string;
  description: string | null;
  status: "requested" | "submitted" | "accepted" | "rejected" | "cancelled";
  dueDate: string | null;
  file: { fileName: string; mimeType: string; sizeBytes: number } | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  requestedBy: string | null;
  reviewedBy: string | null;
};

type PanelData = {
  requests: DocumentRequest[];
  tracking: { linkSentAt: string | null; lastIssuedAt: string | null; lastOpenedAt: string | null };
};

const tr = (fr: boolean, french: string, english: string) => (fr ? french : english);

const PRESETS: [string, string][] = [
  ["Pièce d’identité", "Identity document"],
  ["Diplôme ou certificat", "Diploma or certificate"],
  ["Attestation de travail", "Employment certificate"],
  ["Lettre de recommandation", "Reference letter"],
  ["Certificat médical", "Medical certificate"],
  ["Permis de conduire", "Driving licence"],
];

const STATUS: Record<DocumentRequest["status"], [string, string, string]> = {
  requested: ["En attente du candidat", "Waiting for candidate", "bg-warning/15 text-warning"],
  submitted: ["Reçu · à vérifier", "Received · to review", "bg-brand/12 text-brand"],
  accepted: ["Accepté", "Accepted", "bg-emerald-500/12 text-emerald-600"],
  rejected: ["Refusé · à renvoyer", "Rejected · resend", "bg-critical/12 text-critical"],
  cancelled: ["Annulé", "Cancelled", "bg-surface-2 text-ink-secondary"],
};

function when(value: string | null, fr: boolean) {
  if (!value) return null;
  return new Date(value).toLocaleString(fr ? "fr-FR" : "en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CandidateDocumentsPanel({
  application,
  orgSlug,
  fr,
  editable,
}: {
  application: { id: string; status: string; fullName: string };
  orgSlug: string;
  fr: boolean;
  editable: boolean;
}) {
  const queryClient = useQueryClient();
  const key = ["career-application-documents", orgSlug, application.id];
  const base = `careers/applications/${application.id}`;
  const data = useQuery({
    queryKey: key,
    queryFn: () => get<PanelData>(orgUrl(orgSlug, `${base}/documents`)),
  });
  const refresh = (next: PanelData) => queryClient.setQueryData(key, next);

  const [labels, setLabels] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [message, setMessage] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const sendLink = useMutation({
    mutationFn: () => post<PanelData>(orgUrl(orgSlug, `${base}/tracking-link`), {}),
    onSuccess: (next) => {
      refresh(next);
      toast.success(tr(fr, "Lien de suivi envoyé au candidat.", "Tracking link sent to the candidate."));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const request = useMutation({
    mutationFn: () =>
      post<PanelData>(orgUrl(orgSlug, `${base}/documents`), {
        documents: labels.map((label) => ({ label })),
        message: message.trim() || undefined,
        dueDate: dueDate || undefined,
        notifyCandidate: true,
      }),
    onSuccess: (next) => {
      refresh(next);
      setLabels([]);
      setMessage("");
      setDueDate("");
      setComposerOpen(false);
      toast.success(tr(fr, "Demande envoyée au candidat par e-mail et SMS.", "Request sent to the candidate by e-mail and SMS."));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const review = useMutation({
    mutationFn: (input: { requestId: string; decision: "accepted" | "rejected" | "cancelled"; note?: string }) =>
      patch<PanelData>(orgUrl(orgSlug, `${base}/documents/${input.requestId}`), {
        decision: input.decision,
        note: input.note || undefined,
        notifyCandidate: true,
      }),
    onSuccess: (next, input) => {
      refresh(next);
      setRejecting(null);
      setRejectNote("");
      toast.success(
        input.decision === "accepted"
          ? tr(fr, "Document accepté.", "Document accepted.")
          : input.decision === "rejected"
            ? tr(fr, "Le candidat a été invité à renvoyer le document.", "The candidate was asked to send the document again.")
            : tr(fr, "Demande annulée.", "Request cancelled."),
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const openFile = async (item: DocumentRequest, download: boolean) => {
    const preview = !download && item.file && (item.file.mimeType === "application/pdf" || item.file.mimeType.startsWith("image/"));
    const target = preview ? window.open("", "_blank") : null;
    try {
      const response = await api.get<Blob>(orgUrl(orgSlug, `${base}/documents/${item.id}/file`), {
        params: preview ? { view: "inline" } : undefined,
        responseType: "blob",
      });
      const url = URL.createObjectURL(response.data);
      if (target) target.location.href = url;
      else {
        const link = document.createElement("a");
        link.href = url;
        link.download = item.file?.fileName ?? "document";
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      target?.close();
      toast.error(tr(fr, "Impossible d’ouvrir le document.", "Could not open the document."));
    }
  };

  const addLabel = (value: string) => {
    const clean = value.trim();
    if (!clean || labels.includes(clean) || labels.length >= 10) return;
    setLabels([...labels, clean]);
  };

  const closed = ["rejected", "withdrawn"].includes(application.status);
  const tracking = data.data?.tracking;
  const requests = data.data?.requests ?? [];

  return (
    <section className="rounded-2xl border border-border bg-surface-1 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">{tr(fr, "Espace candidat et documents", "Candidate space and documents")}</h3>
          <p className="mt-1 text-xs leading-5 text-ink-secondary">
            {tracking?.linkSentAt
              ? tr(fr, `Lien de suivi envoyé le ${when(tracking.linkSentAt, fr)}`, `Tracking link sent ${when(tracking.linkSentAt, fr)}`)
              : tr(fr, "Lien de suivi pas encore envoyé (envoi automatique en cours).", "Tracking link not sent yet (automatic sending in progress).")}
            {" · "}
            {tracking?.lastOpenedAt
              ? tr(fr, `ouvert le ${when(tracking.lastOpenedAt, fr)}`, `opened ${when(tracking.lastOpenedAt, fr)}`)
              : tr(fr, "jamais ouvert", "never opened")}
          </p>
        </div>
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" loading={sendLink.isPending} onClick={() => sendLink.mutate()}>
              <Link2 className="size-3.5" />
              {tr(fr, "Renvoyer le lien", "Resend link")}
            </Button>
            {!closed ? (
              <Button size="sm" onClick={() => setComposerOpen(!composerOpen)}>
                <FilePlus2 className="size-3.5" />
                {tr(fr, "Demander des documents", "Request documents")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {composerOpen && editable ? (
        <div className="mt-4 space-y-3 rounded-xl border border-brand/20 bg-brand/[.03] p-4">
          <div>
            <p className="text-xs font-semibold text-ink">{tr(fr, "Documents à demander", "Documents to request")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {PRESETS.map(([french, english]) => {
                const value = fr ? french : english;
                const active = labels.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => (active ? setLabels(labels.filter((item) => item !== value)) : addLabel(value))}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                      active ? "border-brand bg-brand text-brand-ink" : "border-border bg-surface-1 text-ink hover:border-brand/40"
                    }`}
                  >
                    {active ? <Check className="mr-1 inline size-3" /> : <Plus className="mr-1 inline size-3" />}
                    {value}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex gap-2">
              <Input
                value={custom}
                maxLength={160}
                placeholder={tr(fr, "Autre document…", "Other document…")}
                onChange={(event) => setCustom(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addLabel(custom);
                    setCustom("");
                  }
                }}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  addLabel(custom);
                  setCustom("");
                }}
              >
                <Plus className="size-4" />
              </Button>
            </div>
            {labels.filter((label) => !PRESETS.some(([a, b]) => a === label || b === label)).length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {labels
                  .filter((label) => !PRESETS.some(([a, b]) => a === label || b === label))
                  .map((label) => (
                    <span key={label} className="inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1 text-xs font-medium text-brand-ink">
                      {label}
                      <button type="button" onClick={() => setLabels(labels.filter((item) => item !== label))} aria-label="Retirer">
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
              </div>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_170px]">
            <Field label={tr(fr, "Message au candidat (facultatif)", "Message to the candidate (optional)")}>
              <Textarea rows={2} maxLength={800} value={message} onChange={(event) => setMessage(event.target.value)} />
            </Field>
            <Field label={tr(fr, "À envoyer avant le", "Due by")}>
              <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setComposerOpen(false)}>
              {tr(fr, "Annuler", "Cancel")}
            </Button>
            <Button loading={request.isPending} disabled={!labels.length} onClick={() => request.mutate()}>
              <Send className="size-4" />
              {tr(fr, "Envoyer la demande", "Send request")}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        {data.isLoading ? (
          <SkeletonCard rows={2} />
        ) : requests.length ? (
          requests.map((item) => {
            const [french, english, tone] = STATUS[item.status];
            return (
              <article key={item.id} className="rounded-xl border border-border/80 bg-surface-2/35 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{item.label}</p>
                    <p className="text-xs text-ink-secondary">
                      {tr(fr, "Demandé", "Requested")} {when(item.createdAt, fr)}
                      {item.requestedBy ? ` · ${item.requestedBy}` : ""}
                      {item.dueDate ? ` · ${tr(fr, "échéance", "due")} ${new Date(`${item.dueDate}T12:00:00`).toLocaleDateString(fr ? "fr-FR" : "en-GB")}` : ""}
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tone}`}>{fr ? french : english}</span>
                </div>
                {item.file ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
                    <span className="truncate font-medium text-ink">{item.file.fileName}</span>
                    {item.submittedAt ? <span>· {when(item.submittedAt, fr)}</span> : null}
                    <button type="button" onClick={() => void openFile(item, false)} className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
                      <Eye className="size-3.5" /> {tr(fr, "Voir", "View")}
                    </button>
                    <button type="button" onClick={() => void openFile(item, true)} className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
                      <FileDown className="size-3.5" /> {tr(fr, "Télécharger", "Download")}
                    </button>
                  </div>
                ) : null}
                {item.reviewNote ? (
                  <p className="mt-2 text-xs text-ink-secondary">
                    {tr(fr, "Note :", "Note:")} {item.reviewNote}
                    {item.reviewedBy ? ` · ${item.reviewedBy}` : ""}
                  </p>
                ) : null}
                {editable && rejecting === item.id ? (
                  <div className="mt-3 space-y-2">
                    <Input
                      autoFocus
                      maxLength={600}
                      value={rejectNote}
                      placeholder={tr(fr, "Motif visible par le candidat (ex. document illisible)", "Reason shown to the candidate (e.g. unreadable)")}
                      onChange={(event) => setRejectNote(event.target.value)}
                    />
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>
                        {tr(fr, "Annuler", "Cancel")}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        loading={review.isPending}
                        onClick={() => review.mutate({ requestId: item.id, decision: "rejected", note: rejectNote })}
                      >
                        {tr(fr, "Demander un nouvel envoi", "Ask to send again")}
                      </Button>
                    </div>
                  </div>
                ) : editable ? (
                  <div className="mt-2 flex flex-wrap justify-end gap-2">
                    {item.status === "submitted" ? (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => setRejecting(item.id)}>
                          <X className="size-3.5" /> {tr(fr, "Refuser", "Reject")}
                        </Button>
                        <Button size="sm" loading={review.isPending} onClick={() => review.mutate({ requestId: item.id, decision: "accepted" })}>
                          <Check className="size-3.5" /> {tr(fr, "Accepter", "Accept")}
                        </Button>
                      </>
                    ) : null}
                    {item.status === "requested" || item.status === "rejected" ? (
                      <Button size="sm" variant="ghost" onClick={() => review.mutate({ requestId: item.id, decision: "cancelled" })}>
                        {tr(fr, "Annuler la demande", "Cancel request")}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })
        ) : (
          <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-ink-secondary">
            {tr(
              fr,
              "Aucun document demandé. Le candidat peut suivre son statut et lire vos messages dans son Espace candidat.",
              "No documents requested. The candidate can follow their status and read your messages in their candidate space.",
            )}
          </p>
        )}
      </div>
    </section>
  );
}
