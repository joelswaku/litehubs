"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileWarning,
  Gavel,
  Plus,
  Scale,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HrPdfButton } from "@/components/hr/hr-pdf-button";
import { Field as BaseField, Input, Textarea } from "@/components/ui/input";
import {
  EmptyState,
  ErrorState,
  NoAccessState,
  SkeletonCard,
} from "@/components/ui/states";
import { ApiError, get, orgUrl, patch, post } from "@/lib/api";
import { can } from "@/lib/permissions";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";

type Employee = {
  id: string;
  employeeNumber: string;
  fullName: string;
  jobTitle: string;
  province?: { id: string; name: string } | null;
  site?: { id: string; name: string } | null;
};
type Action = {
  id: string;
  reference: string;
  employee: Employee;
  province?: { id: string; name: string } | null;
  site?: { id: string; name: string } | null;
  occurredOn: string;
  reportedOn: string;
  category: string;
  severity: "minor" | "serious" | "gross";
  actionTaken: string;
  description: string;
  employeeStatement?: string | null;
  status:
    "open" | "under_review" | "upheld" | "dismissed" | "appealed" | "closed";
  expiresOn?: string | null;
  raisedByName?: string | null;
  submission?: {
    submittedAt: string;
    submittedByName?: string | null;
  } | null;
  decision?: {
    decidedAt: string;
    decidedByName?: string | null;
    note?: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
};
type Metrics = {
  open: number;
  underReview: number;
  appealed: number;
  closed: number;
  serious: number;
};

const categoryValues = [
  "attendance",
  "conduct",
  "performance",
  "safety",
  "biosecurity",
  "theft",
  "insubordination",
  "other",
];
const severityValues = ["minor", "serious", "gross"];
const actionValues = [
  "none",
  "verbal_warning",
  "written_warning",
  "final_warning",
  "suspension",
  "demotion",
  "dismissal",
];
const statusValues = [
  "open",
  "under_review",
  "upheld",
  "dismissed",
  "appealed",
  "closed",
];
const selectClass =
  "h-10 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20";
const text = (fr: boolean, english: string, french: string) =>
  fr ? french : english;
const words = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (item) => item.toUpperCase());
const date = (value: string | null | undefined, fr: boolean) =>
  value
    ? new Intl.DateTimeFormat(fr ? "fr-FR" : "en-US", {
        dateStyle: "medium",
      }).format(new Date(`${value.slice(0, 10)}T00:00:00`))
    : "—";
const issue = (error: unknown) =>
  error instanceof ApiError
    ? (Object.values(error.fieldErrors).flat()[0] ?? error.message)
    : error
      ? "Impossible de terminer cette action."
      : null;
const statusVariant = (
  value: Action["status"],
): "good" | "warning" | "serious" | "outline" | "info" =>
  value === "upheld" || value === "closed"
    ? "good"
    : value === "dismissed"
      ? "outline"
      : value === "appealed"
        ? "serious"
        : value === "under_review"
          ? "info"
          : "warning";
const severityVariant = (
  value: Action["severity"],
): "good" | "warning" | "serious" =>
  value === "gross" ? "serious" : value === "serious" ? "warning" : "good";

export function DisciplineArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const user = useSessionUser();
  const client = useQueryClient();
  const canRead = can(user, "disciplinary_actions.read");
  const canCreate = can(user, "disciplinary_actions.create");
  const canUpdate = can(user, "disciplinary_actions.update");
  const canSubmitForDecision = can(user, "disciplinary_actions.submit");
  const canMakeFinalDecision =
    user?.activeOrganization?.isOwner === true ||
    user?.roles.includes("general_manager") === true;
  const canReadEmployees = can(user, "employees.read");
  const [selected, setSelected] = useState<Action | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const actions = useQuery({
    queryKey: ["disciplinary-actions", orgSlug],
    queryFn: () =>
      get<{ actions: Action[] }>(orgUrl(orgSlug, "disciplinary-actions")),
    enabled: canRead,
    select: (data) => data.actions,
  });
  const summary = useQuery({
    queryKey: ["disciplinary-summary", orgSlug],
    queryFn: () =>
      get<{ metrics: Metrics }>(orgUrl(orgSlug, "disciplinary-summary")),
    enabled: canRead,
  });
  const employees = useQuery({
    queryKey: ["discipline-employees", orgSlug],
    queryFn: () => get<{ employees: Employee[] }>(orgUrl(orgSlug, "employees")),
    enabled: canReadEmployees,
    select: (data) => data.employees,
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      patch<{ action: Action }>(
        orgUrl(orgSlug, `disciplinary-actions/${id}`),
        body,
      ),
    onSuccess: (result) => {
      setSelected(result.action);
      void client.invalidateQueries({
        queryKey: ["disciplinary-actions", orgSlug],
      });
      void client.invalidateQueries({
        queryKey: ["disciplinary-summary", orgSlug],
      });
    },
  });
  const filtered = useMemo(
    () =>
      (actions.data ?? []).filter(
        (action) => filter === "all" || action.status === filter,
      ),
    [actions.data, filter],
  );
  if (!canRead)
    return (
      <NoAccessState
        what={text(fr, "disciplinary records", "les dossiers disciplinaires")}
      />
    );
  if (actions.isPending || summary.isPending)
    return (
      <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        <SkeletonCard rows={9} />
      </main>
    );
  if (actions.isError || summary.isError)
    return (
      <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        <ErrorState
          description={
            issue(actions.error) || issue(summary.error) || undefined
          }
          onRetry={() => {
            void actions.refetch();
            void summary.refetch();
          }}
        />
      </main>
    );
  const metrics = summary.data?.metrics ?? {
    open: 0,
    underReview: 0,
    appealed: 0,
    closed: 0,
    serious: 0,
  };
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <header className="relative overflow-hidden rounded-3xl border border-amber-300/20 bg-[radial-gradient(circle_at_90%_12%,rgba(255,196,92,.26),transparent_27%),radial-gradient(circle_at_5%_105%,rgba(251,139,36,.21),transparent_35%),linear-gradient(132deg,#3c2439,#6a3145_55%,#9b5832)] px-5 py-7 text-white shadow-[0_24px_54px_-36px_rgba(90,36,38,.95)] sm:px-7 sm:py-8">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-amber-100">
            {text(
              fr,
              "Fair process & accountability",
              "Équité et responsabilité",
            )}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            {text(fr, "Disciplinary actions", "Dossiers disciplinaires")}
          </h1>
          <p className="mt-2 text-sm leading-6 text-amber-50/90">
            {text(
              fr,
              "Handle incidents consistently: facts, employee statement, proportionate action, decision and an auditable record.",
              "Gérez les incidents avec cohérence : faits, déclaration de l’employé, mesure proportionnée, décision et dossier traçable.",
            )}
          </p>
        </div>
        {canCreate ? (
          <div className="relative mt-5">
            <Button
              className="bg-white text-amber-900 hover:bg-amber-50"
              onClick={() => setCreateOpen(true)}
            >
              <Plus />
              {text(fr, "Raise a case", "Ouvrir un dossier")}
            </Button>
          </div>
        ) : null}
      </header>
      <div className="flex justify-end">
        <HrPdfButton orgSlug={orgSlug} report="discipline" fr={fr} className="border-brand/30 bg-brand/10 text-brand hover:bg-brand/15" />
      </div>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric
          icon={FileWarning}
          title={text(fr, "Open", "Ouverts")}
          value={metrics.open}
          note={text(fr, "Needs initial review", "À examiner")}
          tone="warning"
        />
        <Metric
          icon={Scale}
          title={text(fr, "Under review", "En révision")}
          value={metrics.underReview}
          note={text(fr, "Facts being reviewed", "Faits en vérification")}
          tone="brand"
        />
        <Metric
          icon={Gavel}
          title={text(fr, "Appeals", "Recours")}
          value={metrics.appealed}
          note={text(fr, "Needs follow-up", "À traiter")}
          tone="serious"
        />
        <Metric
          icon={BadgeCheck}
          title={text(fr, "Decided", "Décidés")}
          value={metrics.closed}
          note={text(fr, "Closed or decided", "Clôturés ou décidés")}
          tone="good"
        />
        <Metric
          icon={AlertTriangle}
          title={text(fr, "Serious open", "Graves ouverts")}
          value={metrics.serious}
          note={text(fr, "Serious or gross cases", "Cas sérieux ou graves")}
          tone="serious"
        />
      </section>
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,.8fr)]">
        <section className="overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
            <div>
              <h2 className="text-base font-semibold text-ink">
                {text(fr, "Case register", "Registre des dossiers")}
              </h2>
              <p className="mt-1 text-xs leading-5 text-ink-secondary">
                {text(
                  fr,
                  "Open a file to review the allegation, statement, decision and expiry rule.",
                  "Ouvrez un dossier pour consulter les faits, la déclaration, la décision et la règle d’expiration.",
                )}
              </p>
            </div>
            <select
              className={`${selectClass} w-44`}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="all">
                {text(fr, "All cases", "Tous les dossiers")}
              </option>
              {statusValues.map((value) => (
                <option key={value} value={value}>
                  {words(value)}
                </option>
              ))}
            </select>
          </div>
          {filtered.length ? (
            <div className="divide-y divide-border">
              {filtered.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => setSelected(action)}
                  className={`flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-surface-2 ${selected?.id === action.id ? "bg-amber-500/5" : ""}`}
                >
                  <span
                    className={`grid size-10 shrink-0 place-items-center rounded-xl ${action.severity === "gross" ? "bg-critical/10 text-critical" : action.severity === "serious" ? "bg-warning/15 text-warning-ink" : "bg-surface-3 text-brand"}`}
                  >
                    <FileWarning className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-ink">
                        {action.employee.fullName}
                      </span>
                      <Badge variant={statusVariant(action.status)}>
                        {words(action.status)}
                      </Badge>
                      <Badge variant={severityVariant(action.severity)}>
                        {words(action.severity)}
                      </Badge>
                    </span>
                    <span className="mt-1 block truncate text-xs text-ink-secondary">
                      {action.reference} · {words(action.category)} ·{" "}
                      {date(action.occurredOn, fr)}
                    </span>
                  </span>
                  <ChevronRight className="size-4 text-ink-muted" />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={FileWarning}
              title={text(
                fr,
                "No disciplinary case in this view",
                "Aucun dossier dans cette vue",
              )}
              description={text(
                fr,
                "Start a documented, fair process only when an incident must be handled formally.",
                "Démarrez un processus documenté et équitable uniquement lorsqu’un incident doit être traité formellement.",
              )}
              action={
                canCreate
                  ? {
                      label: text(fr, "Raise a case", "Ouvrir un dossier"),
                      onClick: () => setCreateOpen(true),
                    }
                  : undefined
              }
            />
          )}
        </section>
        <ActionDetail
          action={selected}
          fr={fr}
          canUpdate={canUpdate}
          canSubmitForDecision={canSubmitForDecision}
          canMakeFinalDecision={canMakeFinalDecision}
          busy={update.isPending}
          error={issue(update.error)}
          onEdit={() => setEditOpen(true)}
          onReview={() =>
            selected &&
            update.mutate({ id: selected.id, body: { status: "under_review" } })
          }
          onAppeal={() =>
            selected &&
            update.mutate({ id: selected.id, body: { status: "appealed" } })
          }
          onDecide={() => setDecisionOpen(true)}
        />
      </section>
      <section className="grid gap-5 lg:grid-cols-3">
        <InfoCard
          icon={ShieldCheck}
          title={text(fr, "Privacy and access", "Confidentialité et accès")}
          text={text(
            fr,
            "Only roles with the disciplinary permission can open this area. Province-scoped managers only see employees in their assigned provinces.",
            "Seuls les rôles avec l’autorisation disciplinaire peuvent ouvrir cet espace. Les managers limités à une province ne voient que les employés de leurs provinces.",
          )}
        />
        <InfoCard
          icon={UserRound}
          title={text(fr, "Employee statement", "Déclaration de l’employé")}
          text={text(
            fr,
            "Record the employee’s explanation before a decision. This preserves a fair process rather than a one-sided allegation.",
            "Enregistrez l’explication de l’employé avant une décision. Cela préserve un processus équitable plutôt qu’une accusation unilatérale.",
          )}
        />
        <InfoCard
          icon={ClipboardCheck}
          title={text(fr, "Warning validity", "Validité des avertissements")}
          text={text(
            fr,
            "Warnings can expire. An old event should not automatically count forever when a later case is reviewed.",
            "Les avertissements peuvent expirer. Un ancien fait ne doit pas compter indéfiniment lors de l’examen d’un nouveau dossier.",
          )}
        />
      </section>
      {createOpen ? (
        <ActionForm
          fr={fr}
          orgSlug={orgSlug}
          employees={employees.data ?? []}
          hasEmployeeAccess={canReadEmployees}
          onClose={() => setCreateOpen(false)}
        />
      ) : null}
      {editOpen && selected ? (
        <ActionForm
          fr={fr}
          orgSlug={orgSlug}
          action={selected}
          employees={[]}
          hasEmployeeAccess={false}
          onClose={() => setEditOpen(false)}
        />
      ) : null}
      {decisionOpen && selected ? (
        <DecisionDialog
          fr={fr}
          orgSlug={orgSlug}
          action={selected}
          onClose={() => setDecisionOpen(false)}
        />
      ) : null}
    </main>
  );
}
function Metric({
  icon: Icon,
  title,
  value,
  note,
  tone = "neutral",
}: {
  icon: typeof FileWarning;
  title: string;
  value: number;
  note: string;
  tone?: "neutral" | "brand" | "good" | "warning" | "serious";
}) {
  const colors = {
    neutral: "bg-surface-3 text-ink",
    brand: "bg-brand/10 text-brand",
    good: "bg-good/10 text-good-ink",
    warning: "bg-warning/15 text-warning-ink",
    serious: "bg-critical/10 text-critical",
  };
  return (
    <article className="rounded-2xl border border-border bg-surface-1 p-4 shadow-sm">
      <span
        className={`grid size-9 place-items-center rounded-xl ${colors[tone]}`}
      >
        <Icon className="size-4" />
      </span>
      <p className="mt-4 text-xs font-medium text-ink-secondary">{title}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-ink">
        {value}
      </p>
      <p className="mt-1 text-xs text-ink-muted">{note}</p>
    </article>
  );
}
function InfoCard({
  icon: Icon,
  title,
  text: description,
}: {
  icon: typeof ShieldCheck;
  title: string;
  text: string;
}) {
  return (
    <article className="rounded-2xl border border-border bg-surface-1 p-5 shadow-sm">
      <Icon className="size-5 text-brand" />
      <h2 className="mt-4 text-sm font-semibold text-ink">{title}</h2>
      <p className="mt-2 text-xs leading-5 text-ink-secondary">{description}</p>
    </article>
  );
}
function ActionDetail({
  action,
  fr,
  canUpdate,
  canSubmitForDecision,
  canMakeFinalDecision,
  busy,
  error,
  onEdit,
  onReview,
  onAppeal,
  onDecide,
}: {
  action: Action | null;
  fr: boolean;
  canUpdate: boolean;
  canSubmitForDecision: boolean;
  canMakeFinalDecision: boolean;
  busy: boolean;
  error: string | null;
  onEdit: () => void;
  onReview: () => void;
  onAppeal: () => void;
  onDecide: () => void;
}) {
  if (!action)
    return (
      <aside className="rounded-2xl border border-dashed border-border bg-surface-1 p-6">
        <Scale className="size-6 text-ink-muted" />
        <h2 className="mt-4 text-base font-semibold text-ink">
          {text(fr, "Select a case", "Sélectionnez un dossier")}
        </h2>
        <p className="mt-1 text-sm leading-6 text-ink-secondary">
          {text(
            fr,
            "Its facts, employee statement and decision history will appear here.",
            "Ses faits, la déclaration de l’employé et l’historique de décision apparaîtront ici.",
          )}
        </p>
      </aside>
    );
  return (
    <aside className="rounded-2xl border border-border bg-surface-1 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand">
            {action.reference}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-ink">
            {action.employee.fullName}
          </h2>
          <p className="mt-1 text-xs text-ink-secondary">
            #{action.employee.employeeNumber} · {action.employee.jobTitle}
          </p>
        </div>
        <Badge variant={statusVariant(action.status)}>
          {words(action.status)}
        </Badge>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Badge variant={severityVariant(action.severity)}>
          {words(action.severity)}
        </Badge>
        <Badge variant="outline">{words(action.category)}</Badge>
        <Badge variant="outline">{words(action.actionTaken)}</Badge>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <Info
          title={text(fr, "Occurred", "Survenu le")}
          value={date(action.occurredOn, fr)}
        />
        <Info
          title={text(fr, "Reported", "Signalé le")}
          value={date(action.reportedOn, fr)}
        />
        <Info
          title={text(fr, "Site", "Site")}
          value={action.site?.name ?? action.province?.name ?? "—"}
        />
        <Info
          title={text(fr, "Warning expires", "Avertissement expire")}
          value={date(action.expiresOn, fr)}
        />
      </dl>
      <Block
        title={text(fr, "Incident description", "Description des faits")}
        value={action.description}
      />
      <Block
        title={text(fr, "Employee statement", "Déclaration de l’employé")}
        value={
          action.employeeStatement ??
          text(fr, "Not recorded yet", "Pas encore enregistrée")
        }
        muted={!action.employeeStatement}
      />
      {action.status === "open" ? (
        <div className="mt-3 rounded-xl border border-warning/25 bg-warning/5 p-3 text-xs leading-5 text-ink-secondary">
          {text(
            fr,
            "Ce dossier est ouvert. Un responsable RH ou un agent performance autorisé doit vérifier les faits et le soumettre pour décision.",
            "This case is open. An authorized HR or performance officer must verify the facts and submit it for decision.",
          )}
        </div>
      ) : null}
      {action.status === "under_review" ? (
        <div className="mt-3 rounded-xl border border-brand/20 bg-brand-subtle/60 p-3 text-xs leading-5 text-ink-secondary">
          <p className="font-semibold text-brand">
            {text(fr, "En attente de décision finale", "Awaiting final decision")}
          </p>
          <p className="mt-1">
            {action.submission?.submittedByName
              ? `${text(fr, "Soumis par", "Submitted by")} ${action.submission.submittedByName} · ${date(action.submission.submittedAt, fr)}`
              : text(fr, "Soumis par RH ou un agent performance autorisé.", "Submitted by an authorized HR or performance officer.")}
          </p>
        </div>
      ) : null}
      {action.status === "appealed" ? (
        <div className="mt-3 rounded-xl border border-serious/25 bg-serious/5 p-3 text-xs leading-5 text-ink-secondary">
          <p className="font-semibold text-serious">
            {text(fr, "Recours en attente", "Appeal awaiting decision")}
          </p>
          <p className="mt-1">
            {text(fr, "La déduction est suspendue jusqu’à la nouvelle décision de l’Owner ou du General Manager.", "Any deduction is suspended until the Owner or General Manager makes the appeal decision.")}
          </p>
        </div>
      ) : null}
      {action.decision ? (
        <div className="mt-3 rounded-xl border border-good/25 bg-good/5 p-3">
          <p className="text-xs font-semibold text-good-ink">
            {text(fr, "Decision", "Décision")}
          </p>
          <p className="mt-1 text-sm font-medium text-ink">
            {action.decision.decidedByName ?? "—"} ·{" "}
            {date(action.decision.decidedAt, fr)}
          </p>
          {action.decision.note ? (
            <p className="mt-2 text-xs leading-5 text-ink-secondary">
              {action.decision.note}
            </p>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="mt-3 text-xs text-critical">{error}</p> : null}
      {canUpdate || canMakeFinalDecision ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {canUpdate ? (
            <Button size="sm" variant="secondary" onClick={onEdit}>
              {text(fr, "Edit facts", "Modifier les faits")}
            </Button>
          ) : null}
          {action.status === "open" && canSubmitForDecision ? (
            <Button
              size="sm"
              variant="secondary"
              loading={busy}
              onClick={onReview}
            >
              <ClipboardCheck />
              {text(fr, "Submit for final decision", "Soumettre pour décision finale")}
            </Button>
          ) : null}
          {["under_review", "appealed"].includes(action.status) && canMakeFinalDecision ? (
            <Button size="sm" loading={busy} onClick={onDecide}>
              <Gavel />
              {action.status === "appealed"
                ? text(fr, "Décider du recours", "Decide appeal")
                : text(fr, "Make final decision", "Rendre la décision finale")}
            </Button>
          ) : null}
          {["upheld", "dismissed", "closed"].includes(action.status) && canUpdate ? (
            <Button
              size="sm"
              variant="secondary"
              loading={busy}
              onClick={onAppeal}
            >
              {text(fr, "Register appeal", "Enregistrer un recours")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
function Info({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{title}</dt>
      <dd className="mt-1 font-medium text-ink">{value}</dd>
    </div>
  );
}
function Block({
  title,
  value,
  muted = false,
}: {
  title: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="mt-3 rounded-xl bg-surface-2 p-3">
      <p className="text-xs font-semibold text-ink-secondary">{title}</p>
      <p
        className={`mt-1 text-sm leading-6 ${muted ? "text-ink-muted" : "text-ink"}`}
      >
        {value}
      </p>
    </div>
  );
}
function Field({
  label,
  htmlFor,
  children,
  ...props
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
}) {
  const id =
    htmlFor ??
    `discipline-${label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}`;
  return (
    <BaseField label={label} htmlFor={id} {...props}>
      {children}
    </BaseField>
  );
}
function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/55 p-4"
      role="dialog"
      aria-modal="true"
    >
      <section className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-surface-1 shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface-1 px-5 py-4">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <Button
            aria-label="Close"
            size="sm"
            variant="ghost"
            onClick={onClose}
          >
            <X />
          </Button>
        </header>
        <div className="p-5">{children}</div>
      </section>
    </div>
  );
}
function ActionForm({
  fr,
  orgSlug,
  action,
  employees,
  hasEmployeeAccess,
  onClose,
}: {
  fr: boolean;
  orgSlug: string;
  action?: Action;
  employees: Employee[];
  hasEmployeeAccess: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      action
        ? patch<{ action: Action }>(
            orgUrl(orgSlug, `disciplinary-actions/${action.id}`),
            body,
          )
        : post<{ action: Action }>(
            orgUrl(orgSlug, "disciplinary-actions"),
            body,
          ),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["disciplinary-actions", orgSlug],
      });
      void client.invalidateQueries({
        queryKey: ["disciplinary-summary", orgSlug],
      });
      onClose();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    mutation.mutate({
      ...(action ? {} : { employeeId: String(form.get("employeeId") ?? "") }),
      reference: String(form.get("reference") ?? "").trim() || undefined,
      occurredOn: String(form.get("occurredOn") ?? ""),
      reportedOn: String(form.get("reportedOn") ?? "") || undefined,
      category: String(form.get("category") ?? "conduct"),
      severity: String(form.get("severity") ?? "minor"),
      actionTaken: String(form.get("actionTaken") ?? "verbal_warning"),
      description: String(form.get("description") ?? "").trim(),
      employeeStatement:
        String(form.get("employeeStatement") ?? "").trim() || null,
      expiresOn: String(form.get("expiresOn") ?? "").trim() || null,
    });
  };
  return (
    <Dialog
      title={
        action
          ? text(fr, "Edit disciplinary record", "Modifier le dossier")
          : text(
              fr,
              "Raise disciplinary case",
              "Ouvrir un dossier disciplinaire",
            )
      }
      onClose={onClose}
    >
      <form className="space-y-4" onSubmit={submit}>
        {issue(mutation.error) ? (
          <p className="rounded-lg bg-critical/10 p-3 text-sm text-critical">
            {issue(mutation.error)}
          </p>
        ) : null}
        {!action ? (
          <Field label={text(fr, "Employee", "Employé")} required>
            {hasEmployeeAccess ? (
              <select
                className={selectClass}
                name="employeeId"
                defaultValue=""
                required
              >
                <option value="">
                  {text(fr, "Choose an employee", "Choisir un employé")}
                </option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.fullName} · #{employee.employeeNumber} ·{" "}
                    {employee.site?.name ?? employee.province?.name ?? "—"}
                  </option>
                ))}
              </select>
            ) : (
              <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning-ink">
                {text(
                  fr,
                  "Employee-directory permission is required to create a case.",
                  "L’accès au répertoire des employés est requis pour créer un dossier.",
                )}
              </p>
            )}
          </Field>
        ) : (
          <div className="rounded-xl bg-surface-2 p-3 text-sm text-ink">
            <b>{action.employee.fullName}</b>
            <span className="ml-2 text-ink-secondary">
              #{action.employee.employeeNumber}
            </span>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={text(fr, "Reference", "Référence")}
            hint={text(
              fr,
              "Generated automatically if blank.",
              "Générée automatiquement si laissée vide.",
            )}
          >
            <Input name="reference" defaultValue={action?.reference ?? ""} />
          </Field>
          <Field label={text(fr, "Incident date", "Date des faits")} required>
            <Input
              name="occurredOn"
              type="date"
              required
              defaultValue={
                action?.occurredOn ?? new Date().toISOString().slice(0, 10)
              }
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={text(fr, "Reported date", "Date de signalement")}>
            <Input
              name="reportedOn"
              type="date"
              defaultValue={
                action?.reportedOn ?? new Date().toISOString().slice(0, 10)
              }
            />
          </Field>
          <Field label={text(fr, "Category", "Catégorie")} required>
            <select
              className={selectClass}
              name="category"
              defaultValue={action?.category ?? "conduct"}
            >
              {categoryValues.map((value) => (
                <option key={value} value={value}>
                  {words(value)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={text(fr, "Severity", "Gravité")} required>
            <select
              className={selectClass}
              name="severity"
              defaultValue={action?.severity ?? "minor"}
            >
              {severityValues.map((value) => (
                <option key={value} value={value}>
                  {words(value)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={text(fr, "Proposed action", "Mesure proposée")}
            required
          >
            <select
              className={selectClass}
              name="actionTaken"
              defaultValue={action?.actionTaken ?? "verbal_warning"}
            >
              {actionValues.map((value) => (
                <option key={value} value={value}>
                  {words(value)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field
          label={text(fr, "Facts / description", "Faits / description")}
          required
        >
          <Textarea
            name="description"
            rows={5}
            defaultValue={action?.description ?? ""}
            required
          />
        </Field>
        <Field
          label={text(fr, "Employee statement", "Déclaration de l’employé")}
          hint={text(
            fr,
            "Record the employee’s explanation before any decision.",
            "Enregistrez l’explication de l’employé avant toute décision.",
          )}
        >
          <Textarea
            name="employeeStatement"
            rows={4}
            defaultValue={action?.employeeStatement ?? ""}
          />
        </Field>
        <Field
          label={text(fr, "Warning expiry", "Expiration de l’avertissement")}
          hint={text(
            fr,
            "Optional: use this when a warning should stop counting after a defined period.",
            "Facultatif : utilisez cette date lorsqu’un avertissement doit cesser de compter après une période définie.",
          )}
        >
          <Input
            name="expiresOn"
            type="date"
            defaultValue={action?.expiresOn ?? ""}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {text(fr, "Cancel", "Annuler")}
          </Button>
          <Button
            type="submit"
            loading={mutation.isPending}
            disabled={!action && (!hasEmployeeAccess || !employees.length)}
          >
            {action
              ? text(fr, "Save changes", "Enregistrer")
              : text(fr, "Open case", "Ouvrir le dossier")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
function DecisionDialog({
  fr,
  orgSlug,
  action,
  onClose,
}: {
  fr: boolean;
  orgSlug: string;
  action: Action;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      post<{ action: Action }>(
        orgUrl(orgSlug, `disciplinary-actions/${action.id}/decision`),
        body,
      ),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["disciplinary-actions", orgSlug],
      });
      void client.invalidateQueries({
        queryKey: ["disciplinary-summary", orgSlug],
      });
      onClose();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    mutation.mutate({
      status: String(form.get("status") ?? "upheld"),
      actionTaken: String(form.get("actionTaken") ?? action.actionTaken),
      expiresOn: String(form.get("expiresOn") ?? "").trim() || null,
      decisionNote: String(form.get("decisionNote") ?? "").trim() || null,
    });
  };
  return (
    <Dialog
      title={text(fr, "Make final decision", "Rendre la décision finale")}
      onClose={onClose}
    >
      <form className="space-y-4" onSubmit={submit}>
        {issue(mutation.error) ? (
          <p className="rounded-lg bg-critical/10 p-3 text-sm text-critical">
            {issue(mutation.error)}
          </p>
        ) : null}
        <div className="rounded-xl bg-surface-2 p-3 text-sm text-ink">
          <b>{action.reference}</b>
          <p className="mt-1 text-xs text-ink-secondary">
            {action.employee.fullName} · {words(action.category)} ·{" "}
            {date(action.occurredOn, fr)}
          </p>
        </div>
        <Field label={text(fr, "Decision", "Décision")} required>
          <select className={selectClass} name="status" defaultValue="upheld">
            <option value="upheld">{text(fr, "Upheld", "Confirmée")}</option>
            <option value="dismissed">
              {text(fr, "Dismissed", "Rejetée")}
            </option>
            <option value="closed">{text(fr, "Closed", "Clôturée")}</option>
          </select>
        </Field>
        <Field label={text(fr, "Final action", "Mesure finale")} required>
          <select
            className={selectClass}
            name="actionTaken"
            defaultValue={action.actionTaken}
          >
            {actionValues.map((value) => (
              <option key={value} value={value}>
                {words(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={text(fr, "Decision note", "Motif de la décision")}>
          <Textarea
            name="decisionNote"
            rows={5}
            placeholder={text(
              fr,
              "State the facts considered and the reason for the decision.",
              "Indiquez les faits examinés et le motif de la décision.",
            )}
          />
        </Field>
        <Field
          label={text(fr, "Warning expiry", "Expiration de l’avertissement")}
        >
          <Input
            name="expiresOn"
            type="date"
            defaultValue={action.expiresOn ?? ""}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {text(fr, "Cancel", "Annuler")}
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            <Gavel />
            {text(fr, "Confirm final decision", "Confirmer la décision finale")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
