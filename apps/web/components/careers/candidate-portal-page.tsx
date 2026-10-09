"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  Clock3,
  FileCheck2,
  FileText,
  FileUp,
  FileX2,
  LockKeyhole,
  Mail,
  MapPin,
  MessageSquareText,
  SearchCheck,
  Send,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { SkeletonCard } from "@/components/ui/states";
import { get } from "@/lib/api";
import {
  CareersBrandMark,
  careersBrandStyle,
  careersHeroStyle,
  type CareersBranding,
} from "@/components/careers/careers-branding";

type DocumentRequest = {
  id: string;
  label: string;
  description: string | null;
  status: "requested" | "submitted" | "accepted" | "rejected";
  dueDate: string | null;
  file: { fileName: string; mimeType: string; sizeBytes: number } | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
};

type TimelineItem = {
  type: string;
  status?: string;
  message?: string;
  label?: string;
  at: string;
};

type Candidate = {
  organizationName: string;
  fullName: string;
  email: string;
  preferredLanguage: "fr" | "en";
  status: string;
  steps: string[];
  closed: boolean;
  submittedAt: string;
  updatedAt: string;
  job: { code: string; title: string; siteName: string; provinceName: string };
  resume: { fileName: string } | null;
  documentRequests: DocumentRequest[];
  timeline: TimelineItem[];
  linkExpiresAt: string;
  contactEmail: string;
};

const ACCEPT =
  "application/pdf,image/jpeg,image/png,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const t = (fr: boolean, french: string, english: string) => (fr ? french : english);

const STATUS: Record<string, { fr: string; en: string; hintFr: string; hintEn: string }> = {
  received: {
    fr: "Reçue",
    en: "Received",
    hintFr: "Votre dossier est enregistré et attend l’examen de l’équipe.",
    hintEn: "Your application is registered and waiting for review.",
  },
  reviewing: {
    fr: "En cours d’examen",
    en: "Under review",
    hintFr: "L’équipe de recrutement étudie votre dossier.",
    hintEn: "The recruitment team is reviewing your application.",
  },
  shortlisted: {
    fr: "Présélectionnée",
    en: "Shortlisted",
    hintFr: "Votre profil fait partie de la sélection. La suite vous sera communiquée ici.",
    hintEn: "Your profile is on the shortlist. Next steps will appear here.",
  },
  interview: {
    fr: "Entretien",
    en: "Interview",
    hintFr: "Vous êtes retenu(e) pour un entretien. Consultez les messages ci-dessous.",
    hintEn: "You are selected for an interview. See the messages below.",
  },
  offered: {
    fr: "Offre",
    en: "Offer",
    hintFr: "Une offre vous est proposée. Vérifiez vos e-mails pour la fiche d’intégration.",
    hintEn: "An offer is available. Check your e-mail for the onboarding form.",
  },
  hired: {
    fr: "Recruté(e)",
    en: "Hired",
    hintFr: "Félicitations ! L’équipe RH prépare votre intégration.",
    hintEn: "Congratulations! HR is preparing your onboarding.",
  },
  rejected: {
    fr: "Non retenue",
    en: "Not selected",
    hintFr: "Votre candidature n’a pas été retenue pour ce poste. Merci pour votre intérêt.",
    hintEn: "Your application was not selected for this role. Thank you for your interest.",
  },
  withdrawn: {
    fr: "Retirée",
    en: "Withdrawn",
    hintFr: "Cette candidature est enregistrée comme retirée.",
    hintEn: "This application is recorded as withdrawn.",
  },
};

const statusLabel = (status: string, fr: boolean) =>
  STATUS[status] ? (fr ? STATUS[status].fr : STATUS[status].en) : status;

function formatDate(value: string | null | undefined, fr: boolean, withTime = false) {
  if (!value) return "";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return date.toLocaleDateString(fr ? "fr-FR" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
  return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}

const trackEndpoint = (orgSlug: string, token: string) =>
  `/public/organizations/${encodeURIComponent(orgSlug)}/careers/track/${encodeURIComponent(token)}`;

function PortalShell({
  orgSlug,
  fr,
  setFr,
  organizationName,
  branding,
  children,
}: {
  orgSlug: string;
  fr: boolean;
  setFr: (value: boolean) => void;
  organizationName?: string;
  branding?: CareersBranding | null;
  children: ReactNode;
}) {
  return (
    <main style={careersBrandStyle(branding)} className="min-h-dvh bg-[radial-gradient(circle_at_18%_-5%,rgba(37,99,235,.14),transparent_36%),radial-gradient(circle_at_92%_14%,rgba(22,163,74,.10),transparent_28%),var(--color-page)] px-4 py-6 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              href={`/careers/${orgSlug}`}
              title={t(fr, "Offres d’emploi", "Job openings")}
              className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-1 text-ink shadow-sm transition hover:bg-surface-2"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <CareersBrandMark
              branding={branding}
              organizationName={organizationName ?? branding?.displayName ?? t(fr, "Carrières", "Careers")}
              href={`/careers/${orgSlug}`}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/20 bg-surface-1 px-3 py-1.5 text-xs font-semibold text-brand shadow-sm">
              <LockKeyhole className="size-3.5" />
              <span className="hidden sm:inline">{t(fr, "Espace candidat privé", "Private candidate space")}</span>
              <span className="sm:hidden">{t(fr, "Privé", "Private")}</span>
            </span>
            <button
              type="button"
              className="rounded-lg border border-border bg-surface-1 px-3 py-1.5 text-xs font-bold text-ink shadow-sm transition hover:bg-surface-2"
              onClick={() => setFr(!fr)}
            >
              {fr ? "EN" : "FR"}
            </button>
          </div>
        </header>
        {children}
      </div>
    </main>
  );
}

export function CandidatePortalPage({ orgSlug, token }: { orgSlug: string; token: string }) {
  const [language, setLanguage] = useState<"fr" | "en" | null>(null);
  const tracking = useQuery({
    queryKey: ["public-career-tracking", orgSlug, token],
    queryFn: () => get<{ candidate: Candidate; branding?: CareersBranding }>(trackEndpoint(orgSlug, token)),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
  });
  const candidate = tracking.data?.candidate;
  const fr = (language ?? candidate?.preferredLanguage ?? "fr") === "fr";
  const setFr = (value: boolean) => setLanguage(value ? "fr" : "en");

  if (tracking.isLoading)
    return (
      <PortalShell orgSlug={orgSlug} fr={fr} setFr={setFr}>
        <div className="rounded-3xl border border-border bg-surface-1 p-7 shadow-xl">
          <SkeletonCard rows={8} />
        </div>
      </PortalShell>
    );

  if (tracking.isError || !candidate)
    return (
      <PortalShell orgSlug={orgSlug} fr={fr} setFr={setFr}>
        <section className="rounded-3xl border border-border bg-surface-1 p-8 text-center shadow-xl sm:p-12">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-warning/15 text-warning">
            <Clock3 className="size-7" />
          </span>
          <h1 className="mt-5 text-2xl font-semibold text-ink">
            {t(fr, "Ce lien n’est plus valide", "This link is no longer valid")}
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-ink-secondary">
            {t(
              fr,
              "Les liens de suivi sont personnels et expirent après quelques semaines. Demandez un nouveau lien avec l’adresse e-mail utilisée pour votre candidature.",
              "Tracking links are personal and expire after a few weeks. Request a new link with the e-mail address used for your application.",
            )}
          </p>
          <Link
            href={`/careers/${orgSlug}/suivi`}
            className="mt-6 inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-brand-ink shadow-sm transition hover:brightness-110"
          >
            <Mail className="size-4" />
            {t(fr, "Recevoir un nouveau lien", "Get a new link")}
          </Link>
        </section>
      </PortalShell>
    );

  const status = STATUS[candidate.status];
  const open = candidate.documentRequests.filter((item) => item.status === "requested" || item.status === "rejected");

  return (
    <PortalShell orgSlug={orgSlug} fr={fr} setFr={setFr} organizationName={candidate.organizationName} branding={tracking.data?.branding}>
      <section className="overflow-hidden rounded-3xl border border-brand/20 bg-surface-1 shadow-[0_24px_70px_-45px_rgb(15_23_42_/_.75)]">
        <div style={careersHeroStyle(tracking.data?.branding)} className="bg-[radial-gradient(circle_at_82%_-25%,rgba(125,211,252,.34),transparent_42%),linear-gradient(125deg,#172554,#2563a6)] px-6 py-8 text-white sm:px-9 sm:py-9">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-bold tracking-[.14em]">
            <SearchCheck className="size-3.5" />
            {t(fr, "SUIVI DE CANDIDATURE", "APPLICATION TRACKING")}
          </p>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
            {t(fr, "Bonjour", "Hello")} {candidate.fullName}
          </h1>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-sky-50">
            <span className="inline-flex items-center gap-1.5">
              <BriefcaseBusiness className="size-4" /> {candidate.job.title}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-4" /> {candidate.job.siteName}
              {candidate.job.provinceName ? ` · ${candidate.job.provinceName}` : ""}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-4" /> {t(fr, "Envoyée le", "Sent on")} {formatDate(candidate.submittedAt, fr)}
            </span>
          </div>
        </div>

        <div className="space-y-6 p-5 sm:p-8">
          <div
            className={`rounded-2xl border p-5 ${
              candidate.closed
                ? "border-border bg-surface-2/50"
                : candidate.status === "hired"
                  ? "border-emerald-500/30 bg-emerald-500/[.06]"
                  : "border-brand/25 bg-brand/[.05]"
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-ink-secondary">
              {t(fr, "Statut actuel", "Current status")}
            </p>
            <p className="mt-1 text-xl font-semibold text-ink">{statusLabel(candidate.status, fr)}</p>
            {status ? (
              <p className="mt-1 text-sm leading-6 text-ink-secondary">{fr ? status.hintFr : status.hintEn}</p>
            ) : null}
            {!candidate.closed ? <Stepper steps={candidate.steps} current={candidate.status} fr={fr} /> : null}
          </div>

          {open.length ? (
            <div className="flex gap-3 rounded-2xl border border-warning/35 bg-warning/[.08] p-4 text-sm leading-6 text-ink">
              <FileUp className="mt-0.5 size-5 shrink-0 text-warning" />
              <p>
                <strong>
                  {open.length === 1
                    ? t(fr, "1 document à envoyer.", "1 document to send.")
                    : t(fr, `${open.length} documents à envoyer.`, `${open.length} documents to send.`)}
                </strong>{" "}
                {t(fr, "Envoyez-les ci-dessous pour que l’équipe poursuive l’examen.", "Upload them below so the team can continue.")}
              </p>
            </div>
          ) : null}

          {candidate.documentRequests.length ? (
            <section>
              <h2 className="flex items-center gap-2 font-semibold text-ink">
                <FileText className="size-4 text-brand" />
                {t(fr, "Documents demandés", "Requested documents")}
              </h2>
              <div className="mt-3 space-y-3">
                {candidate.documentRequests.map((request) => (
                  <DocumentRequestCard
                    key={request.id}
                    request={request}
                    fr={fr}
                    canUpload={!candidate.closed && candidate.status !== "hired"}
                    orgSlug={orgSlug}
                    token={token}
                    onUploaded={() => void tracking.refetch()}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <h2 className="flex items-center gap-2 font-semibold text-ink">
              <Clock3 className="size-4 text-brand" />
              {t(fr, "Historique", "History")}
            </h2>
            <ol className="mt-3 space-y-0">
              {candidate.timeline.map((item, index) => (
                <TimelineRow key={`${item.type}-${item.at}-${index}`} item={item} fr={fr} last={index === candidate.timeline.length - 1} />
              ))}
            </ol>
          </section>

          <div className="grid gap-3 rounded-2xl border border-border bg-surface-2/40 p-4 text-xs leading-5 text-ink-secondary sm:grid-cols-2">
            <p className="flex gap-2">
              <LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-brand" />
              {t(
                fr,
                `Ce lien est personnel et valable jusqu’au ${formatDate(candidate.linkExpiresAt, fr)}. Ne le partagez pas.`,
                `This link is personal and valid until ${formatDate(candidate.linkExpiresAt, fr)}. Do not share it.`,
              )}
            </p>
            <p className="flex gap-2">
              <Mail className="mt-0.5 size-3.5 shrink-0 text-brand" />
              <span>
                {t(fr, "Une question ? ", "Questions? ")}
                <a className="font-semibold text-brand underline underline-offset-2" href={`mailto:${candidate.contactEmail}`}>
                  {candidate.contactEmail}
                </a>
              </span>
            </p>
          </div>
        </div>
      </section>
    </PortalShell>
  );
}

function Stepper({ steps, current, fr }: { steps: string[]; current: string; fr: boolean }) {
  const index = steps.indexOf(current);
  return (
    <ol className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-6">
      {steps.map((step, position) => {
        const done = position < index;
        const active = position === index;
        return (
          <li key={step} className="flex flex-col items-center gap-1.5 text-center">
            <span
              className={`grid size-8 place-items-center rounded-full border-2 text-xs font-bold ${
                done
                  ? "border-emerald-500 bg-emerald-500 text-white"
                  : active
                    ? "border-brand bg-brand text-brand-ink shadow-[0_0_0_4px_rgb(37_99_235_/_.15)]"
                    : "border-border bg-surface-1 text-ink-secondary"
              }`}
            >
              {done ? <CheckCircle2 className="size-4" /> : position + 1}
            </span>
            <span className={`text-[11px] leading-4 ${active ? "font-semibold text-ink" : "text-ink-secondary"}`}>
              {statusLabel(step, fr)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const DOCUMENT_STATUS: Record<DocumentRequest["status"], { fr: string; en: string; tone: string }> = {
  requested: { fr: "À envoyer", en: "To send", tone: "bg-warning/15 text-warning" },
  submitted: { fr: "Envoyé · en vérification", en: "Sent · being checked", tone: "bg-brand/12 text-brand" },
  accepted: { fr: "Accepté", en: "Accepted", tone: "bg-emerald-500/12 text-emerald-600" },
  rejected: { fr: "À renvoyer", en: "Send again", tone: "bg-critical/12 text-critical" },
};

function DocumentRequestCard({
  request,
  fr,
  canUpload,
  orgSlug,
  token,
  onUploaded,
}: {
  request: DocumentRequest;
  fr: boolean;
  canUpload: boolean;
  orgSlug: string;
  token: string;
  onUploaded: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error(t(fr, "Choisissez un fichier.", "Choose a file."));
      const data = new FormData();
      data.append("file", file);
      const response = await fetch(`/api/v1${trackEndpoint(orgSlug, token)}/documents/${request.id}`, {
        method: "POST",
        body: data,
        credentials: "same-origin",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(body?.error?.message ?? t(fr, "Impossible d’envoyer le document.", "Could not send the document."));
      return body;
    },
    onSuccess: () => {
      toast.success(t(fr, "Document envoyé. Merci !", "Document sent. Thank you!"));
      setFile(null);
      if (input.current) input.current.value = "";
      onUploaded();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const meta = DOCUMENT_STATUS[request.status];
  const uploadable = canUpload && request.status !== "accepted";
  const Icon = request.status === "accepted" ? FileCheck2 : request.status === "rejected" ? FileX2 : FileText;
  return (
    <article className="rounded-2xl border border-border bg-surface-1 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink-secondary">
            <Icon className="size-5" />
          </span>
          <div className="min-w-0">
            <h3 className="font-semibold text-ink">{request.label}</h3>
            {request.description ? (
              <p className="mt-0.5 text-sm leading-6 text-ink-secondary">{request.description}</p>
            ) : null}
            {request.dueDate ? (
              <p className="mt-1 text-xs text-ink-secondary">
                {t(fr, "À envoyer avant le", "Due by")} {formatDate(request.dueDate, fr)}
              </p>
            ) : null}
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${meta.tone}`}>{fr ? meta.fr : meta.en}</span>
      </div>
      {request.status === "rejected" && request.reviewNote ? (
        <p className="mt-3 rounded-xl border border-critical/25 bg-critical/[.06] px-3 py-2 text-sm text-ink">
          <strong>{t(fr, "Motif : ", "Reason: ")}</strong>
          {request.reviewNote}
        </p>
      ) : null}
      {request.file ? (
        <p className="mt-3 text-xs text-ink-secondary">
          {t(fr, "Fichier envoyé :", "File sent:")} <span className="font-medium text-ink">{request.file.fileName}</span> ·{" "}
          {formatSize(request.file.sizeBytes)}
          {request.submittedAt ? ` · ${formatDate(request.submittedAt, fr, true)}` : ""}
        </p>
      ) : null}
      {uploadable ? (
        <form
          className="mt-4 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center"
          onSubmit={(event) => {
            event.preventDefault();
            upload.mutate();
          }}
        >
          <Input
            ref={input}
            type="file"
            accept={ACCEPT}
            className="sm:flex-1"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <Button loading={upload.isPending} disabled={!file} className="h-10 shrink-0">
            <Send className="size-4" />
            {request.status === "submitted" ? t(fr, "Remplacer", "Replace") : t(fr, "Envoyer", "Send")}
          </Button>
        </form>
      ) : null}
    </article>
  );
}

function TimelineRow({ item, fr, last }: { item: TimelineItem; fr: boolean; last: boolean }) {
  let icon = <CircleDot className="size-4" />;
  let title = "";
  let body: string | null = null;
  let tone = "bg-brand/12 text-brand";
  if (item.type === "status") {
    title = `${t(fr, "Statut :", "Status:")} ${statusLabel(item.status ?? "", fr)}`;
    if (item.status === "rejected" || item.status === "withdrawn") {
      icon = <XCircle className="size-4" />;
      tone = "bg-surface-2 text-ink-secondary";
    } else if (item.status === "hired") {
      icon = <CheckCircle2 className="size-4" />;
      tone = "bg-emerald-500/12 text-emerald-600";
    }
  } else if (item.type === "message") {
    icon = <MessageSquareText className="size-4" />;
    title = t(fr, "Message de l’équipe de recrutement", "Message from the recruitment team");
    body = item.message ?? null;
    tone = "bg-sky-500/12 text-sky-600";
  } else {
    icon = <FileText className="size-4" />;
    const labels: Record<string, [string, string]> = {
      document_requested: ["Document demandé", "Document requested"],
      document_submitted: ["Document envoyé", "Document sent"],
      document_accepted: ["Document accepté", "Document accepted"],
      document_rejected: ["Document à renvoyer", "Document to send again"],
      document_cancelled: ["Demande de document annulée", "Document request cancelled"],
    };
    const pair = labels[item.type] ?? ["Document", "Document"];
    title = `${fr ? pair[0] : pair[1]} · ${item.label ?? ""}`;
    tone =
      item.type === "document_accepted"
        ? "bg-emerald-500/12 text-emerald-600"
        : item.type === "document_rejected"
          ? "bg-critical/12 text-critical"
          : "bg-warning/15 text-warning";
  }
  return (
    <li className="relative flex gap-3 pb-5">
      {!last ? <span className="absolute left-4 top-9 w-px bg-border" style={{ height: "calc(100% - 2.25rem)" }} aria-hidden /> : null}
      <span className={`relative grid size-8 shrink-0 place-items-center rounded-full ${tone}`}>{icon}</span>
      <div className="min-w-0 pt-1">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="text-xs text-ink-secondary">{formatDate(item.at, fr, true)}</p>
        {body ? (
          <p className="mt-2 whitespace-pre-line rounded-xl border border-border bg-surface-2/40 px-3 py-2 text-sm leading-6 text-ink">
            {body}
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function CandidatePortalRecoverPage({ orgSlug }: { orgSlug: string }) {
  const [fr, setFr] = useState(true);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const brand = useQuery({
    queryKey: ["public-careers", orgSlug],
    queryFn: () => get<{ branding?: CareersBranding }>(`/public/organizations/${encodeURIComponent(orgSlug)}/careers/jobs`),
    staleTime: 60_000,
  });
  const branding = brand.data?.branding;
  const recover = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/v1/public/organizations/${encodeURIComponent(orgSlug)}/careers/track/recover`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
          credentials: "same-origin",
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(body?.error?.message ?? t(fr, "Impossible d’envoyer la demande.", "Could not send the request."));
      return body as { message: string };
    },
    onSuccess: () =>
      setSent(
        t(
          fr,
          "Si une candidature correspond à cette adresse, un nouveau lien de suivi vient de vous être envoyé par e-mail. Pensez à vérifier vos courriers indésirables.",
          "If an application matches this address, a new tracking link has just been sent by e-mail. Remember to check your spam folder.",
        ),
      ),
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <PortalShell orgSlug={orgSlug} fr={fr} setFr={setFr} branding={branding}>
      <section className="mx-auto max-w-xl overflow-hidden rounded-3xl border border-brand/20 bg-surface-1 shadow-[0_24px_70px_-45px_rgb(15_23_42_/_.75)]">
        <div style={careersHeroStyle(branding)} className="bg-[radial-gradient(circle_at_82%_-25%,rgba(125,211,252,.34),transparent_42%),linear-gradient(125deg,#172554,#2563a6)] px-6 py-8 text-white sm:px-8">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-bold tracking-[.14em]">
            <SearchCheck className="size-3.5" />
            {t(fr, "SUIVI DE CANDIDATURE", "APPLICATION TRACKING")}
          </p>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            {t(fr, "Retrouver ma candidature", "Find my application")}
          </h1>
          <p className="mt-2 text-sm leading-6 text-sky-50">
            {t(
              fr,
              "Saisissez l’adresse e-mail utilisée pour postuler. Nous vous enverrons un lien personnel vers votre Espace candidat. Aucun compte ni mot de passe n’est nécessaire.",
              "Enter the e-mail address you used to apply. We will send you a personal link to your candidate space. No account or password is needed.",
            )}
          </p>
        </div>
        <div className="p-6 sm:p-8">
          {sent ? (
            <div className="flex gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/[.06] p-4 text-sm leading-6 text-ink">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
              <p>{sent}</p>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                recover.mutate();
              }}
            >
              <Field label={t(fr, "Adresse e-mail", "E-mail address")} required>
                <Input
                  required
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="nom@exemple.com"
                />
              </Field>
              <Button loading={recover.isPending} className="h-11 w-full">
                <Mail className="size-4" />
                {t(fr, "Recevoir mon lien de suivi", "Send my tracking link")}
              </Button>
            </form>
          )}
        </div>
      </section>
    </PortalShell>
  );
}
