"use client";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Award,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Goal,
  Clock3,
  AlertTriangle,
  FileWarning,
  SlidersHorizontal,
  Plus,
  Star,
  Target,
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
import { can, isOwner } from "@/lib/permissions";
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
type GoalItem = {
  id: string;
  reviewId: string;
  title: string;
  description?: string | null;
  target?: string | null;
  dueOn?: string | null;
  weight?: number | null;
  progress: number;
  status: "not_started" | "in_progress" | "achieved" | "cancelled";
};
type Review = {
  id: string;
  employee: Employee;
  province?: { id: string; name: string } | null;
  site?: { id: string; name: string } | null;
  periodStart: string;
  periodEnd: string;
  reviewType: string;
  reviewedOn?: string | null;
  overallRating?: number | null;
  strengths?: string | null;
  areasToImprove?: string | null;
  goals?: string | null;
  employeeComments?: string | null;
  status: "draft" | "submitted" | "acknowledged" | "closed";
  reviewer?: { id: string; fullName?: string | null } | null;
  acknowledgedAt?: string | null;
  goalCount: number;
  achievedGoalCount: number;
};
type Metrics = {
  total: number;
  draft: number;
  submitted: number;
  acknowledged: number;
  averageRating: number;
};type Policy = {
  attendanceWeight: number; punctualityWeight: number; dailyReportWeight: number; taskWeight: number; conductWeight: number;
  workingDays: number[]; dailyReportsRequired: boolean; graceMinutes: number; minimumObservations: number;
  minorDeduction: number; seriousDeduction: number; grossDeduction: number; flaggedReportDeduction: number;
};
type AutoScore = {
  employee: Employee; score: number | null; level: "not_enough_data" | "excellent" | "good" | "medium" | "needs_improvement" | "critical";
  provisional: boolean; observations: number; issues: string[];
  attendance: { scheduledDays: number; presentDays: number; lateDays: number; absentDays: number; leaveDays: number; unrecordedDays: number; score: number | null };
  dailyReports: { expected: number; submitted: number; missing: number; flagged: number; score: number | null };
  tasks: { assigned: number; completed: number; overdue: number; score: number | null };
  conduct: { minorActions: number; seriousActions: number; grossActions: number; score: number | null };
};
type Analytics = { policy: Policy; period: { from: string; to: string }; employees: AutoScore[]; generatedAt: string };
const reviewTypes = [
  "probation",
  "quarterly",
  "half_year",
  "annual",
  "promotion",
  "exit",
];
const reviewStatuses = ["draft", "submitted", "acknowledged", "closed"];
const goalStatuses = ["not_started", "in_progress", "achieved", "cancelled"];
const selectClass =
  "h-10 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20";
const t = (fr: boolean, en: string, frText: string) => (fr ? frText : en);
const words = (v: string) =>
  v.replace(/_/g, " ").replace(/\b\w/g, (x) => x.toUpperCase());
const date = (v: string | null | undefined, fr: boolean) =>
  v
    ? new Intl.DateTimeFormat(fr ? "fr-FR" : "en-US", {
        dateStyle: "medium",
      }).format(new Date(`${v.slice(0, 10)}T00:00:00`))
    : "—";
const issue = (e: unknown) =>
  e instanceof ApiError
    ? (Object.values(e.fieldErrors).flat()[0] ?? e.message)
    : e
      ? "Impossible de terminer cette action."
      : null;
const statusVariant = (
  v: Review["status"],
): "good" | "warning" | "info" | "outline" =>
  v === "closed" || v === "acknowledged"
    ? "good"
    : v === "submitted"
      ? "info"
      : v === "draft"
        ? "warning"
        : "outline";

export function PerformanceArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const user = useSessionUser();
  const client = useQueryClient();
  const canRead = can(user, "performance.read"),
    canCreate = can(user, "performance.create"),
    canUpdate = can(user, "performance.update"),
    canEmployees = can(user, "employees.read");
  const [selected, setSelected] = useState<Review | null>(null),
    [reviewForm, setReviewForm] = useState<Review | "new" | null>(null),
    [goalForm, setGoalForm] = useState<GoalItem | "new" | null>(null),
    [filter, setFilter] = useState("all"),
    [policyOpen, setPolicyOpen] = useState(false),
    [scoreFrom, setScoreFrom] = useState(() => { const day = new Date(); day.setDate(day.getDate() - 29); return day.toISOString().slice(0, 10); }),
    [scoreTo, setScoreTo] = useState(() => new Date().toISOString().slice(0, 10));
  const reviews = useQuery({
    queryKey: ["performance-reviews", orgSlug],
    queryFn: () =>
      get<{ reviews: Review[] }>(orgUrl(orgSlug, "performance-reviews")),
    enabled: canRead,
    select: (d) => d.reviews,
  });
  const summary = useQuery({
    queryKey: ["performance-summary", orgSlug],
    queryFn: () =>
      get<{ metrics: Metrics }>(orgUrl(orgSlug, "performance-summary")),
    enabled: canRead,
  });
  const analytics = useQuery({
    queryKey: ["performance-analytics", orgSlug, scoreFrom, scoreTo],
    queryFn: () => get<Analytics>(orgUrl(orgSlug, `performance-analytics?from=${scoreFrom}&to=${scoreTo}`)),
    enabled: canRead,
  });
  const policy = useQuery({
    queryKey: ["performance-policy", orgSlug],
    queryFn: () => get<{ policy: Policy }>(orgUrl(orgSlug, "performance-policy")),
    enabled: canRead,
    select: (data) => data.policy,
  });  const employees = useQuery({
    queryKey: ["performance-employees", orgSlug],
    queryFn: () => get<{ employees: Employee[] }>(orgUrl(orgSlug, "employees")),
    enabled: canEmployees,
    select: (d) => d.employees,
  });
  const goals = useQuery({
    queryKey: ["performance-goals", orgSlug, selected?.id],
    queryFn: () =>
      get<{ goals: GoalItem[] }>(
        orgUrl(orgSlug, `performance-reviews/${selected!.id}/goals`),
      ),
    enabled: canRead && Boolean(selected),
    select: (d) => d.goals,
  });
  const updateReview = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      patch<{ review: Review }>(
        orgUrl(orgSlug, `performance-reviews/${id}`),
        body,
      ),
    onSuccess: (r) => {
      setSelected(r.review);
      void client.invalidateQueries({
        queryKey: ["performance-reviews", orgSlug],
      });
      void client.invalidateQueries({
        queryKey: ["performance-summary", orgSlug],
      });
    },
  });
  const acknowledge = useMutation({
    mutationFn: (id: string) =>
      post<{ review: Review }>(
        orgUrl(orgSlug, `performance-reviews/${id}/acknowledge`),
        {},
      ),
    onSuccess: (r) => {
      setSelected(r.review);
      void client.invalidateQueries({
        queryKey: ["performance-reviews", orgSlug],
      });
      void client.invalidateQueries({
        queryKey: ["performance-summary", orgSlug],
      });
    },
  });
  const rows = useMemo(
    () =>
      (reviews.data ?? []).filter(
        (r) => filter === "all" || r.status === filter,
      ),
    [reviews.data, filter],
  );
  if (!canRead)
    return (
      <NoAccessState
        what={t(fr, "performance reviews", "les évaluations de performance")}
      />
    );
  if (reviews.isPending || summary.isPending || analytics.isPending || policy.isPending)
    return (
      <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        <SkeletonCard rows={9} />
      </main>
    );
  if (reviews.isError || summary.isError || analytics.isError || policy.isError)
    return (
      <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        <ErrorState
          description={
            issue(reviews.error) || issue(summary.error) || issue(analytics.error) || issue(policy.error) || undefined
          }
          onRetry={() => {
            void reviews.refetch();
            void summary.refetch();
            void analytics.refetch();
            void policy.refetch();
          }}
        />
      </main>
    );
  const metrics = summary.data?.metrics ?? {
    total: 0,
    draft: 0,
    submitted: 0,
    acknowledged: 0,
    averageRating: 0,
  };
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <header className="relative overflow-hidden rounded-3xl border border-sky-300/20 bg-[radial-gradient(circle_at_88%_12%,rgba(78,205,255,.24),transparent_27%),radial-gradient(circle_at_8%_105%,rgba(69,211,171,.2),transparent_35%),linear-gradient(132deg,#112b4c,#15587d_53%,#137469)] px-5 py-7 text-white shadow-[0_24px_54px_-36px_rgba(6,58,72,.95)] sm:px-7 sm:py-8">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-sky-100">
            {t(
              fr,
              "People growth & accountability",
              "Développement et responsabilité",
            )}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            {t(fr, "Performance reviews", "Évaluations de performance")}
          </h1>
          <p className="mt-2 text-sm leading-6 text-sky-50/90">
            {t(
              fr,
              "Set expectations, recognise strengths, address gaps and turn the review into a practical employee growth plan.",
              "Fixez les attentes, reconnaissez les forces, traitez les écarts et transformez l’évaluation en plan de développement concret.",
            )}
          </p>
        </div>
        <div className="relative mt-5 flex flex-wrap gap-2">
          {isOwner(user) ? <Button variant="secondary" className="border-white/20 bg-white/10 text-white hover:bg-white/20" onClick={() => setPolicyOpen(true)}><SlidersHorizontal />{t(fr, "Scoring rules", "Règles de calcul")}</Button> : null}
          {canCreate ? <Button className="bg-white text-sky-900 hover:bg-sky-50" onClick={() => setReviewForm("new")}><Plus />{t(fr, "Start review", "Démarrer une évaluation")}</Button> : null}
        </div>
      </header>
      <div className="flex justify-end">
        <HrPdfButton orgSlug={orgSlug} report="performance" fr={fr} className="border-brand/30 bg-brand/10 text-brand hover:bg-brand/15" />
      </div>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric
          icon={ClipboardCheck}
          title={t(fr, "Reviews", "Évaluations")}
          value={metrics.total}
          note={t(fr, "In this workspace", "Dans cet espace")}
          tone="brand"
        />
        <Metric
          icon={Target}
          title={t(fr, "Drafts", "Brouillons")}
          value={metrics.draft}
          note={t(fr, "Still being prepared", "En préparation")}
          tone="warning"
        />
        <Metric
          icon={UserRound}
          title={t(fr, "Awaiting acknowledgement", "À valider")}
          value={metrics.submitted}
          note={t(
            fr,
            "Employee response needed",
            "Réponse de l’employé attendue",
          )}
          tone="brand"
        />
        <Metric
          icon={CheckCircle2}
          title={t(fr, "Acknowledged", "Validées")}
          value={metrics.acknowledged}
          note={t(fr, "Employee has responded", "Employé a répondu")}
          tone="good"
        />
        <Metric
          icon={Star}
          title={t(fr, "Average rating", "Note moyenne")}
          value={Number(metrics.averageRating.toFixed(1))}
          note={t(fr, "Out of 5", "Sur 5")}
          tone="neutral"
        />
      </section>
      <AutomaticPerformancePanel data={analytics.data} fr={fr} from={scoreFrom} to={scoreTo} onFrom={setScoreFrom} onTo={setScoreTo} onRefresh={() => void analytics.refetch()} />
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.18fr)_minmax(20rem,.82fr)]">
        <section className="overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
            <div>
              <h2 className="text-base font-semibold text-ink">
                {t(fr, "Review register", "Registre des évaluations")}
              </h2>
              <p className="mt-1 text-xs leading-5 text-ink-secondary">
                {t(
                  fr,
                  "Select an evaluation to review its rating, feedback, objectives and acknowledgement.",
                  "Sélectionnez une évaluation pour consulter sa note, les retours, les objectifs et la validation.",
                )}
              </p>
            </div>
            <select
              className={`${selectClass} w-44`}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">
                {t(fr, "All statuses", "Tous les statuts")}
              </option>
              {reviewStatuses.map((v) => (
                <option key={v} value={v}>
                  {words(v)}
                </option>
              ))}
            </select>
          </div>
          {rows.length ? (
            <div className="divide-y divide-border">
              {rows.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelected(r)}
                  className={`flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-surface-2 ${selected?.id === r.id ? "bg-brand/5" : ""}`}
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sky-500/10 text-sky-700">
                    <BarChart3 className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-ink">
                        {r.employee.fullName}
                      </span>
                      <Badge variant={statusVariant(r.status)}>
                        {words(r.status)}
                      </Badge>
                      {r.overallRating ? (
                        <Badge variant="outline">{r.overallRating}/5</Badge>
                      ) : null}
                    </span>
                    <span className="mt-1 block truncate text-xs text-ink-secondary">
                      {words(r.reviewType)} · {date(r.periodStart, fr)} →{" "}
                      {date(r.periodEnd, fr)} · {r.achievedGoalCount}/
                      {r.goalCount} {t(fr, "goals", "objectifs")}
                    </span>
                  </span>
                  <ChevronRight className="size-4 text-ink-muted" />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={BarChart3}
              title={t(
                fr,
                "No reviews in this view",
                "Aucune évaluation dans cette vue",
              )}
              description={t(
                fr,
                "Start a review to make employee performance, goals and support visible.",
                "Démarrez une évaluation pour rendre visibles la performance, les objectifs et l’accompagnement.",
              )}
              action={
                canCreate
                  ? {
                      label: t(fr, "Start review", "Démarrer une évaluation"),
                      onClick: () => setReviewForm("new"),
                    }
                  : undefined
              }
            />
          )}
        </section>
        <ReviewDetail
          review={selected}
          goals={goals.data ?? []}
          goalsLoading={goals.isPending}
          fr={fr}
          canUpdate={canUpdate}
          canCreate={canCreate}
          isOwnReview={Boolean(
            selected && user?.fullName === selected.employee.fullName,
          )}
          busy={updateReview.isPending || acknowledge.isPending}
          error={issue(updateReview.error) || issue(acknowledge.error)}
          onEdit={() => selected && setReviewForm(selected)}
          onSubmit={() =>
            selected &&
            updateReview.mutate({
              id: selected.id,
              body: {
                status: "submitted",
                reviewedOn: new Date().toISOString().slice(0, 10),
              },
            })
          }
          onAcknowledge={() => selected && acknowledge.mutate(selected.id)}
          onAddGoal={() => setGoalForm("new")}
          onEditGoal={(goal) => setGoalForm(goal)}
        />
      </section>
      {reviewForm ? (
        <ReviewDialog
          fr={fr}
          orgSlug={orgSlug}
          review={reviewForm === "new" ? null : reviewForm}
          employees={employees.data ?? []}
          hasEmployeeAccess={canEmployees}
          onClose={() => setReviewForm(null)}
        />
      ) : null}
      {policyOpen && policy.data ? <PerformancePolicyDialog orgSlug={orgSlug} fr={fr} policy={policy.data} onClose={() => setPolicyOpen(false)} onSaved={() => { void policy.refetch(); void analytics.refetch(); }} /> : null}
      {goalForm && selected ? (
        <GoalDialog
          fr={fr}
          orgSlug={orgSlug}
          review={selected}
          goal={goalForm === "new" ? null : goalForm}
          onClose={() => setGoalForm(null)}
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
  icon: typeof BarChart3;
  title: string;
  value: number;
  note: string;
  tone?: "neutral" | "brand" | "good" | "warning";
}) {
  const c = {
    neutral: "bg-surface-3 text-ink",
    brand: "bg-brand/10 text-brand",
    good: "bg-good/10 text-good-ink",
    warning: "bg-warning/15 text-warning-ink",
  };
  return (
    <article className="rounded-2xl border border-border bg-surface-1 p-4 shadow-sm">
      <span className={`grid size-9 place-items-center rounded-xl ${c[tone]}`}>
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
    `performance-${label
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
function ReviewDetail({
  review,
  goals,
  goalsLoading,
  fr,
  canUpdate,
  canCreate,
  isOwnReview,
  busy,
  error,
  onEdit,
  onSubmit,
  onAcknowledge,
  onAddGoal,
  onEditGoal,
}: {
  review: Review | null;
  goals: GoalItem[];
  goalsLoading: boolean;
  fr: boolean;
  canUpdate: boolean;
  canCreate: boolean;
  isOwnReview: boolean;
  busy: boolean;
  error: string | null;
  onEdit: () => void;
  onSubmit: () => void;
  onAcknowledge: () => void;
  onAddGoal: () => void;
  onEditGoal: (g: GoalItem) => void;
}) {
  if (!review)
    return (
      <aside className="rounded-2xl border border-dashed border-border bg-surface-1 p-6">
        <BarChart3 className="size-6 text-ink-muted" />
        <h2 className="mt-4 text-base font-semibold text-ink">
          {t(fr, "Select a review", "Sélectionnez une évaluation")}
        </h2>
        <p className="mt-1 text-sm leading-6 text-ink-secondary">
          {t(
            fr,
            "Its manager feedback, employee response and development goals will appear here.",
            "Ses retours de manager, la réponse de l’employé et ses objectifs de développement apparaîtront ici.",
          )}
        </p>
      </aside>
    );
  return (
    <aside className="rounded-2xl border border-border bg-surface-1 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand">
            {words(review.reviewType)}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-ink">
            {review.employee.fullName}
          </h2>
          <p className="mt-1 text-xs text-ink-secondary">
            #{review.employee.employeeNumber} · {review.employee.jobTitle}
          </p>
        </div>
        <Badge variant={statusVariant(review.status)}>
          {words(review.status)}
        </Badge>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <Info
          title={t(fr, "Period", "Période")}
          value={`${date(review.periodStart, fr)} → ${date(review.periodEnd, fr)}`}
        />
        <Info
          title={t(fr, "Rating", "Note")}
          value={review.overallRating ? `${review.overallRating}/5` : "—"}
        />
        <Info
          title={t(fr, "Reviewer", "Évaluateur")}
          value={review.reviewer?.fullName ?? "—"}
        />
        <Info
          title={t(fr, "Acknowledged", "Validée")}
          value={date(review.acknowledgedAt, fr)}
        />
      </dl>
      <Block
        title={t(fr, "Strengths", "Points forts")}
        value={
          review.strengths ?? t(fr, "Not recorded yet", "Pas encore renseigné")
        }
      />
      <Block
        title={t(fr, "Areas to improve", "Axes d’amélioration")}
        value={
          review.areasToImprove ??
          t(fr, "Not recorded yet", "Pas encore renseigné")
        }
      />
      {review.employeeComments ? (
        <Block
          title={t(fr, "Employee comments", "Commentaires de l’employé")}
          value={review.employeeComments}
        />
      ) : null}
      <div className="mt-5 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">
              {t(fr, "Development objectives", "Objectifs de développement")}
            </h3>
            <p className="mt-1 text-xs text-ink-secondary">
              {review.achievedGoalCount}/{review.goalCount}{" "}
              {t(fr, "achieved", "atteint(s)")}
            </p>
          </div>
          {canCreate ? (
            <Button size="sm" onClick={onAddGoal}>
              <Plus />
              {t(fr, "Add", "Ajouter")}
            </Button>
          ) : null}
        </div>
        {goalsLoading ? (
          <p className="mt-3 text-sm text-ink-secondary">
            {t(fr, "Loading objectives…", "Chargement des objectifs…")}
          </p>
        ) : goals.length ? (
          <div className="mt-3 space-y-2">
            {goals.map((g) => (
              <button
                type="button"
                key={g.id}
                onClick={() => canUpdate && onEditGoal(g)}
                className="w-full rounded-xl border border-border p-3 text-left transition hover:border-brand/35 hover:bg-brand/5"
              >
                <div className="flex items-center gap-2">
                  <Target className="size-4 text-brand" />
                  <b className="min-w-0 flex-1 truncate text-sm text-ink">
                    {g.title}
                  </b>
                  <Badge
                    variant={
                      g.status === "achieved"
                        ? "good"
                        : g.status === "in_progress"
                          ? "info"
                          : "outline"
                    }
                  >
                    {words(g.status)}
                  </Badge>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className="h-full rounded-full bg-brand"
                    style={{ width: `${g.progress}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-ink-secondary">
                  {g.progress}% · {t(fr, "Target", "Cible")} : {g.target ?? "—"}{" "}
                  · {t(fr, "Due", "Échéance")} : {date(g.dueOn, fr)}
                </p>
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-xl border border-dashed border-border p-3 text-xs text-ink-secondary">
            {t(
              fr,
              "No structured objective yet. Add the first concrete next step.",
              "Aucun objectif structuré. Ajoutez la première prochaine étape concrète.",
            )}
          </p>
        )}
      </div>
      {error ? <p className="mt-3 text-xs text-critical">{error}</p> : null}
      <div className="mt-5 flex flex-wrap gap-2">
        {canUpdate ? (
          <Button size="sm" variant="secondary" onClick={onEdit}>
            {t(fr, "Edit review", "Modifier")}
          </Button>
        ) : null}
        {canUpdate && review.status === "draft" ? (
          <Button size="sm" loading={busy} onClick={onSubmit}>
            {t(fr, "Submit to employee", "Envoyer à l’employé")}
          </Button>
        ) : null}
        {canUpdate && isOwnReview && review.status === "submitted" ? (
          <Button size="sm" loading={busy} onClick={onAcknowledge}>
            <CheckCircle2 />
            {t(fr, "Acknowledge", "Valider")}
          </Button>
        ) : null}
      </div>
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
function Block({ title, value }: { title: string; value: string }) {
  return (
    <div className="mt-3 rounded-xl bg-surface-2 p-3">
      <p className="text-xs font-semibold text-ink-secondary">{title}</p>
      <p className="mt-1 text-sm leading-6 text-ink">{value}</p>
    </div>
  );
}
function ReviewDialog({
  fr,
  orgSlug,
  review,
  employees,
  hasEmployeeAccess,
  onClose,
}: {
  fr: boolean;
  orgSlug: string;
  review: Review | null;
  employees: Employee[];
  hasEmployeeAccess: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      review
        ? patch<{ review: Review }>(
            orgUrl(orgSlug, `performance-reviews/${review.id}`),
            body,
          )
        : post<{ review: Review }>(
            orgUrl(orgSlug, "performance-reviews"),
            body,
          ),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["performance-reviews", orgSlug],
      });
      void client.invalidateQueries({
        queryKey: ["performance-summary", orgSlug],
      });
      onClose();
    },
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const rating = String(f.get("overallRating") ?? "").trim();
    mutation.mutate({
      ...(review ? {} : { employeeId: String(f.get("employeeId") ?? "") }),
      periodStart: String(f.get("periodStart") ?? ""),
      periodEnd: String(f.get("periodEnd") ?? ""),
      reviewType: String(f.get("reviewType") ?? "annual"),
      reviewedOn: String(f.get("reviewedOn") ?? "").trim() || null,
      overallRating: rating ? Number(rating) : null,
      reviewerId: String(f.get("reviewerId") ?? "").trim() || null,
      status: String(f.get("status") ?? "draft"),
      strengths: String(f.get("strengths") ?? "").trim() || null,
      areasToImprove: String(f.get("areasToImprove") ?? "").trim() || null,
      goals: String(f.get("goals") ?? "").trim() || null,
    });
  };
  return (
    <Dialog
      title={
        review
          ? t(fr, "Edit performance review", "Modifier l’évaluation")
          : t(fr, "Start performance review", "Démarrer une évaluation")
      }
      onClose={onClose}
    >
      <form className="space-y-4" onSubmit={submit}>
        {issue(mutation.error) ? (
          <p className="rounded-lg bg-critical/10 p-3 text-sm text-critical">
            {issue(mutation.error)}
          </p>
        ) : null}
        {!review ? (
          <Field label={t(fr, "Employee", "Employé")} required>
            {hasEmployeeAccess ? (
              <select
                className={selectClass}
                name="employeeId"
                defaultValue=""
                required
              >
                <option value="">
                  {t(fr, "Choose an employee", "Choisir un employé")}
                </option>
                {employees.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.fullName} · #{x.employeeNumber}
                  </option>
                ))}
              </select>
            ) : (
              <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning-ink">
                {t(
                  fr,
                  "Employee-directory permission is required to start a review.",
                  "L’accès au répertoire des employés est requis pour démarrer une évaluation.",
                )}
              </p>
            )}
          </Field>
        ) : (
          <div className="rounded-xl bg-surface-2 p-3 text-sm text-ink">
            <b>{review.employee.fullName}</b>
            <span className="ml-2 text-ink-secondary">
              #{review.employee.employeeNumber}
            </span>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t(fr, "Review type", "Type d’évaluation")} required>
            <select
              className={selectClass}
              name="reviewType"
              defaultValue={review?.reviewType ?? "annual"}
            >
              {reviewTypes.map((v) => (
                <option key={v} value={v}>
                  {words(v)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t(fr, "Status", "Statut")} required>
            <select
              className={selectClass}
              name="status"
              defaultValue={review?.status ?? "draft"}
            >
              {reviewStatuses
                .filter((v) => v !== "acknowledged")
                .map((v) => (
                  <option key={v} value={v}>
                    {words(v)}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t(fr, "Period start", "Début de période")} required>
            <Input
              name="periodStart"
              type="date"
              required
              defaultValue={
                review?.periodStart ?? new Date().toISOString().slice(0, 10)
              }
            />
          </Field>
          <Field label={t(fr, "Period end", "Fin de période")} required>
            <Input
              name="periodEnd"
              type="date"
              required
              defaultValue={
                review?.periodEnd ?? new Date().toISOString().slice(0, 10)
              }
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t(fr, "Review date", "Date d’évaluation")}>
            <Input
              name="reviewedOn"
              type="date"
              defaultValue={review?.reviewedOn ?? ""}
            />
          </Field>
          <Field label={t(fr, "Overall rating / 5", "Note globale / 5")}>
            <Input
              name="overallRating"
              type="number"
              min="1"
              max="5"
              step="0.25"
              defaultValue={review?.overallRating ?? ""}
            />
          </Field>
        </div>
        <Field label={t(fr, "Reviewer", "Évaluateur")}>
          <select
            className={selectClass}
            name="reviewerId"
            defaultValue={review?.reviewer?.id ?? ""}
          >
            <option value="">
              {t(fr, "No reviewer selected", "Aucun évaluateur")}
            </option>
            {employees.map((x) => (
              <option key={x.id} value={x.id}>
                {x.fullName} · #{x.employeeNumber}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t(fr, "Strengths", "Points forts")}>
          <Textarea
            name="strengths"
            rows={3}
            defaultValue={review?.strengths ?? ""}
          />
        </Field>
        <Field label={t(fr, "Areas to improve", "Axes d’amélioration")}>
          <Textarea
            name="areasToImprove"
            rows={3}
            defaultValue={review?.areasToImprove ?? ""}
          />
        </Field>
        <Field
          label={t(
            fr,
            "Manager notes / next steps",
            "Notes du manager / prochaines étapes",
          )}
        >
          <Textarea name="goals" rows={3} defaultValue={review?.goals ?? ""} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t(fr, "Cancel", "Annuler")}
          </Button>
          <Button
            type="submit"
            loading={mutation.isPending}
            disabled={!review && (!hasEmployeeAccess || !employees.length)}
          >
            {review
              ? t(fr, "Save changes", "Enregistrer")
              : t(fr, "Create review", "Créer")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
function GoalDialog({
  fr,
  orgSlug,
  review,
  goal,
  onClose,
}: {
  fr: boolean;
  orgSlug: string;
  review: Review;
  goal: GoalItem | null;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      goal
        ? patch<{ goal: GoalItem }>(
            orgUrl(orgSlug, `performance-goals/${goal.id}`),
            body,
          )
        : post<{ goal: GoalItem }>(
            orgUrl(orgSlug, `performance-reviews/${review.id}/goals`),
            body,
          ),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["performance-goals", orgSlug, review.id],
      });
      void client.invalidateQueries({
        queryKey: ["performance-reviews", orgSlug],
      });
      onClose();
    },
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const weight = String(f.get("weight") ?? "").trim(),
      progress = String(f.get("progress") ?? "").trim();
    mutation.mutate({
      title: String(f.get("title") ?? "").trim(),
      description: String(f.get("description") ?? "").trim() || null,
      target: String(f.get("target") ?? "").trim() || null,
      dueOn: String(f.get("dueOn") ?? "").trim() || null,
      weight: weight ? Number(weight) : null,
      progress: progress ? Number(progress) : 0,
      status: String(f.get("status") ?? "not_started"),
    });
  };
  return (
    <Dialog
      title={
        goal
          ? t(fr, "Edit objective", "Modifier l’objectif")
          : t(
              fr,
              "Add development objective",
              "Ajouter un objectif de développement",
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
        <Field label={t(fr, "Objective", "Objectif")} required>
          <Input name="title" required defaultValue={goal?.title ?? ""} />
        </Field>
        <Field label={t(fr, "Success target", "Cible de réussite")}>
          <Input
            name="target"
            defaultValue={goal?.target ?? ""}
            placeholder={t(
              fr,
              "Example: Complete biosecurity certification",
              "Exemple : Terminer la certification biosécurité",
            )}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t(fr, "Due date", "Échéance")}>
            <Input name="dueOn" type="date" defaultValue={goal?.dueOn ?? ""} />
          </Field>
          <Field label={t(fr, "Weight (%)", "Poids (%)")}>
            <Input
              name="weight"
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              defaultValue={goal?.weight ?? ""}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t(fr, "Progress (%)", "Avancement (%)")}>
            <Input
              name="progress"
              type="number"
              min="0"
              max="100"
              defaultValue={goal?.progress ?? 0}
            />
          </Field>
          <Field label={t(fr, "Status", "Statut")}>
            <select
              className={selectClass}
              name="status"
              defaultValue={goal?.status ?? "not_started"}
            >
              {goalStatuses.map((v) => (
                <option key={v} value={v}>
                  {words(v)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label={t(fr, "Description", "Description")}>
          <Textarea
            name="description"
            rows={4}
            defaultValue={goal?.description ?? ""}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t(fr, "Cancel", "Annuler")}
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            <Goal />
            {goal
              ? t(fr, "Save changes", "Enregistrer")
              : t(fr, "Add objective", "Ajouter")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const levelCopy = (level: AutoScore["level"], fr: boolean) => ({ not_enough_data: t(fr, "Data needed", "Données insuffisantes"), excellent: t(fr, "Excellent", "Excellent"), good: t(fr, "Good", "Bon"), medium: t(fr, "Average", "Moyen"), needs_improvement: t(fr, "Needs improvement", "À améliorer"), critical: t(fr, "Critical", "Critique") })[level];
const levelTone = (level: AutoScore["level"]): "good" | "info" | "warning" | "serious" | "outline" => level === "excellent" || level === "good" ? "good" : level === "medium" ? "info" : level === "needs_improvement" ? "warning" : level === "critical" ? "serious" : "outline";
const dateInput = "h-10 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";
function AutomaticPerformancePanel({ data, fr, from, to, onFrom, onTo, onRefresh }: { data: Analytics | undefined; fr: boolean; from: string; to: string; onFrom: (value: string) => void; onTo: (value: string) => void; onRefresh: () => void }) {
  const rows = data?.employees ?? [];
  const attention = rows.filter((row) => row.level === "needs_improvement" || row.level === "critical").length;
  const scored = rows.filter((row) => row.score !== null);
  const average = scored.length ? scored.reduce((total, row) => total + (row.score ?? 0), 0) / scored.length : null;
  return <section className="overflow-hidden rounded-2xl border border-border-strong/80 bg-surface-1 shadow-[0_18px_40px_-32px_rgba(15,23,42,.48)]"><div className="border-b border-border bg-[radial-gradient(circle_at_92%_0%,rgba(59,130,246,.13),transparent_30%),linear-gradient(110deg,rgba(20,184,166,.08),transparent_46%)] p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex gap-3"><span className="grid size-11 place-items-center rounded-xl border border-brand/20 bg-brand-subtle text-brand"><Award className="size-5" /></span><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-brand">{t(fr, "Automatic signals", "Signaux automatiques")}</p><h2 className="mt-1 text-lg font-semibold text-ink">{t(fr, "Verified employee performance", "Performance employé vérifiée")}</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-ink-secondary">{t(fr, "The score uses registered attendance, punctuality status, daily reports, assigned tasks and upheld discipline actions. It never edits the underlying records.", "Le score utilise la présence enregistrée, le statut de ponctualité, les rapports quotidiens, les tâches affectées et les décisions disciplinaires confirmées. Il ne modifie jamais les données sources.")}</p></div></div><Button variant="secondary" onClick={onRefresh}><BarChart3 />{t(fr, "Refresh", "Actualiser")}</Button></div><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="grid gap-1.5 text-xs font-medium text-ink-secondary"><span>{t(fr, "From", "Du")}</span><input className={dateInput} type="date" value={from} max={to} onChange={(event) => onFrom(event.target.value)} /></label><label className="grid gap-1.5 text-xs font-medium text-ink-secondary"><span>{t(fr, "To", "Au")}</span><input className={dateInput} type="date" value={to} min={from} onChange={(event) => onTo(event.target.value)} /></label><AutoMetric title={t(fr, "Scored employees", "Employés notés")} value={`${scored.length}/${rows.length}`} icon={UserRound} /><AutoMetric title={t(fr, "Needs support", "À accompagner")} value={String(attention)} icon={AlertTriangle} serious={attention > 0} /></div></div><div className="grid gap-4 p-5 xl:grid-cols-[minmax(0,1fr)_18rem]"><div>{rows.length ? <div className="divide-y divide-border">{rows.map((row) => <article key={row.employee.id} className="py-4 first:pt-0 last:pb-0"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-ink">{row.employee.fullName}</h3><span className="text-xs text-ink-muted">#{row.employee.employeeNumber}</span><Badge variant={levelTone(row.level)}>{levelCopy(row.level, fr)}</Badge>{row.provisional && row.score !== null ? <Badge variant="outline">{t(fr, "Provisional", "Provisoire")}</Badge> : null}</div><p className="mt-1 text-xs text-ink-secondary">{row.employee.jobTitle}{row.employee.site?.name ? ` · ${row.employee.site.name}` : ""}</p></div><div className="flex items-center gap-3"><div className="text-right"><p className="text-2xl font-semibold tracking-tight text-ink">{row.score === null ? "—" : `${Math.round(row.score)}%`}</p><p className="text-[11px] text-ink-muted">{row.score === null ? t(fr, "More records needed", "Plus de données nécessaires") : `${row.observations} ${t(fr, "observations", "observations")}`}</p></div><div className={`grid size-11 place-items-center rounded-full border-4 ${row.level === "critical" ? "border-critical/30 text-critical" : row.level === "needs_improvement" ? "border-warning/35 text-warning-ink" : "border-brand/25 text-brand"}`}><Award className="size-4" /></div></div></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5"><Signal label={t(fr, "Presence", "Présence")} value={row.attendance.scheduledDays ? `${row.attendance.presentDays + row.attendance.lateDays}/${row.attendance.scheduledDays}` : "—"} note={row.attendance.unrecordedDays ? `${row.attendance.unrecordedDays} ${t(fr, "missing", "non renseigné(s)")}` : t(fr, "recorded", "enregistrée")} alert={row.attendance.unrecordedDays > 0 || row.attendance.absentDays > 0} /><Signal label={t(fr, "Punctuality", "Ponctualité")} value={row.attendance.score === null ? "—" : `${Math.round(row.attendance.score)}%`} note={`${row.attendance.lateDays} ${t(fr, "late", "retard(s)")}`} alert={row.attendance.lateDays > 0} /><Signal label={t(fr, "Daily reports", "Rapports quotidiens")} value={row.dailyReports.expected ? `${row.dailyReports.submitted}/${row.dailyReports.expected}` : "—"} note={row.dailyReports.missing ? `${row.dailyReports.missing} ${t(fr, "missing", "manquant(s)")}` : t(fr, "up to date", "à jour")} alert={row.dailyReports.missing > 0 || row.dailyReports.flagged > 0} /><Signal label={t(fr, "Assigned tasks", "Tâches affectées")} value={row.tasks.assigned ? `${row.tasks.completed}/${row.tasks.assigned}` : "—"} note={row.tasks.overdue ? `${row.tasks.overdue} ${t(fr, "overdue", "en retard")}` : t(fr, "none overdue", "aucun retard")} alert={row.tasks.overdue > 0} /><Signal label={t(fr, "Conduct", "Conduite")} value={row.conduct.score === null ? "—" : `${Math.round(row.conduct.score)}%`} note={row.conduct.minorActions + row.conduct.seriousActions + row.conduct.grossActions ? t(fr, "decision on record", "décision enregistrée") : t(fr, "no confirmed action", "aucune décision confirmée")} alert={row.conduct.seriousActions + row.conduct.grossActions > 0} /></div>{row.issues.length ? <p className="mt-3 text-xs font-medium text-warning-ink">{t(fr, "Points to address:", "Points à traiter :")} {row.issues.map((issue) => ({ missing_attendance: t(fr, "attendance not recorded", "présence non enregistrée"), absent_days: t(fr, "absence", "absence"), late_arrivals: t(fr, "late arrival", "retard"), missing_daily_reports: t(fr, "missing daily report", "rapport quotidien manquant"), overdue_tasks: t(fr, "overdue task", "tâche en retard"), disciplinary_actions: t(fr, "disciplinary decision", "décision disciplinaire"), flagged_reports: t(fr, "flagged report", "rapport signalé") })[issue] ?? issue).join(" · ")}</p> : null}</article>)}</div> : <EmptyState icon={Award} title={t(fr, "No employee performance data", "Aucune donnée de performance employé")} description={t(fr, "Assign employees to shifts and record attendance, reports or tasks. The score appears automatically as work is recorded.", "Affectez les employés à des horaires et enregistrez présence, rapports ou tâches. Le score apparaîtra automatiquement au fil des enregistrements.")} />}</div><aside className="rounded-xl border border-border bg-surface-2/65 p-4"><p className="text-xs font-semibold uppercase tracking-[.12em] text-ink-muted">{t(fr, "Scoring context", "Contexte du calcul")}</p><p className="mt-2 text-3xl font-semibold text-ink">{average === null ? "—" : `${Math.round(average)}%`}</p><p className="mt-1 text-xs text-ink-secondary">{t(fr, "Average across employees with enough recorded work.", "Moyenne des employés ayant assez d’activité enregistrée.")}</p><dl className="mt-5 space-y-3 border-t border-border pt-4 text-sm"><ScoreRule label={t(fr, "Attendance", "Présence")} value={`${data?.policy.attendanceWeight ?? 0}%`} /><ScoreRule label={t(fr, "Punctuality", "Ponctualité")} value={`${data?.policy.punctualityWeight ?? 0}%`} /><ScoreRule label={t(fr, "Daily reports", "Rapports quotidiens")} value={`${data?.policy.dailyReportWeight ?? 0}%`} /><ScoreRule label={t(fr, "Tasks", "Tâches")} value={`${data?.policy.taskWeight ?? 0}%`} /><ScoreRule label={t(fr, "Conduct", "Conduite")} value={`${data?.policy.conductWeight ?? 0}%`} /></dl></aside></div></section>;
}
function AutoMetric({ title, value, icon: Icon, serious = false }: { title: string; value: string; icon: typeof Award; serious?: boolean }) { return <div className={`rounded-xl border p-3 ${serious ? "border-warning/30 bg-warning/10" : "border-border bg-surface-1"}`}><Icon className={`size-4 ${serious ? "text-warning-ink" : "text-brand"}`} /><p className="mt-2 text-xs text-ink-secondary">{title}</p><p className="mt-1 text-xl font-semibold text-ink">{value}</p></div>; }
function Signal({ label, value, note, alert }: { label: string; value: string; note: string; alert?: boolean }) { return <div className={`rounded-lg border p-2.5 ${alert ? "border-warning/25 bg-warning/5" : "border-border bg-surface-2/60"}`}><p className="text-[11px] font-medium text-ink-muted">{label}</p><p className="mt-1 text-base font-semibold tabular-nums text-ink">{value}</p><p className={`mt-0.5 text-[11px] ${alert ? "text-warning-ink" : "text-ink-secondary"}`}>{note}</p></div>; }
function ScoreRule({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-3"><dt className="text-xs text-ink-secondary">{label}</dt><dd className="text-xs font-semibold text-ink">{value}</dd></div>; }
function PerformancePolicyDialog({ orgSlug, fr, policy, onClose, onSaved }: { orgSlug: string; fr: boolean; policy: Policy; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<Policy>(policy); const mutation = useMutation({ mutationFn: (body: Policy) => patch<{ policy: Policy }>(orgUrl(orgSlug, "performance-policy"), body), onSuccess: () => { onSaved(); onClose(); } });
  const total = draft.attendanceWeight + draft.punctualityWeight + draft.dailyReportWeight + draft.taskWeight + draft.conductWeight;
  const number = (key: keyof Policy, value: string) => setDraft((current) => ({ ...current, [key]: Math.max(0, Number(value) || 0) }));
  const toggleDay = (day: number) => setDraft((current) => ({ ...current, workingDays: current.workingDays.includes(day) ? current.workingDays.filter((value) => value !== day) : [...current.workingDays, day].sort((a, b) => a - b) }));
  const error = issue(mutation.error);
  return <Dialog title={t(fr, "Automatic performance rules", "Règles automatiques de performance")} onClose={onClose}><p className="text-sm leading-6 text-ink-secondary">{t(fr, "Only the Owner can change these company-wide rules. Scores are calculated from existing records; they never replace a manager’s formal review.", "Seul le propriétaire peut modifier ces règles pour toute l’entreprise. Les scores sont calculés depuis les enregistrements existants ; ils ne remplacent jamais une évaluation formelle du manager.")}</p><form className="mt-5 space-y-5" onSubmit={(event) => { event.preventDefault(); mutation.mutate(draft); }}><div className="rounded-xl border border-border bg-surface-2/65 p-4"><div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold text-ink">{t(fr, "Score weights", "Pondération du score")}</h3><p className="mt-1 text-xs text-ink-secondary">{t(fr, "The five weights must equal 100%.", "Les cinq pondérations doivent totaliser 100 %.")}</p></div><Badge variant={Math.abs(total - 100) < .001 ? "good" : "serious"}>{total}% / 100%</Badge></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><PolicyNumber label={t(fr, "Attendance", "Présence")} value={draft.attendanceWeight} onChange={(value) => number("attendanceWeight", value)} /><PolicyNumber label={t(fr, "Punctuality", "Ponctualité")} value={draft.punctualityWeight} onChange={(value) => number("punctualityWeight", value)} /><PolicyNumber label={t(fr, "Daily reports", "Rapports quotidiens")} value={draft.dailyReportWeight} onChange={(value) => number("dailyReportWeight", value)} /><PolicyNumber label={t(fr, "Tasks", "Tâches")} value={draft.taskWeight} onChange={(value) => number("taskWeight", value)} /><PolicyNumber label={t(fr, "Conduct", "Conduite")} value={draft.conductWeight} onChange={(value) => number("conductWeight", value)} /></div></div><div className="grid gap-4 sm:grid-cols-2"><div className="rounded-xl border border-border p-4"><h3 className="font-semibold text-ink">{t(fr, "Expected attendance", "Présence attendue")}</h3><p className="mt-1 text-xs leading-5 text-ink-secondary">{t(fr, "Only people assigned to a shift are expected to attend. Leave is not counted as attendance.", "Seules les personnes affectées à un horaire sont attendues. Le congé ne compte pas comme présence.")}</p><div className="mt-3 flex flex-wrap gap-2">{[[1,t(fr,"Mon","Lun")],[2,t(fr,"Tue","Mar")],[3,t(fr,"Wed","Mer")],[4,t(fr,"Thu","Jeu")],[5,t(fr,"Fri","Ven")],[6,t(fr,"Sat","Sam")],[7,t(fr,"Sun","Dim")]].map(([day,name]) => <label key={String(day)} className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-xs text-ink"><input type="checkbox" checked={draft.workingDays.includes(Number(day))} onChange={() => toggleDay(Number(day))} className="accent-[var(--brand)]" />{name}</label>)}</div><div className="mt-3"><PolicyNumber label={t(fr, "Minimum observations", "Observations minimales")} value={draft.minimumObservations} max={60} suffix="" onChange={(value) => number("minimumObservations", value)} /></div></div><div className="rounded-xl border border-border p-4"><label className="flex items-start gap-3 text-sm text-ink"><input type="checkbox" checked={draft.dailyReportsRequired} onChange={(event) => setDraft((current) => ({ ...current, dailyReportsRequired: event.target.checked }))} className="mt-0.5 size-4 accent-[var(--brand)]" /><span><b>{t(fr, "Daily report required", "Rapport quotidien requis")}</b><small className="mt-1 block text-xs leading-5 text-ink-secondary">{t(fr, "When enabled, a report is expected for every recorded work day.", "Lorsqu’il est activé, un rapport est attendu pour chaque jour travaillé enregistré.")}</small></span></label><div className="mt-4 grid gap-3"><PolicyNumber label={t(fr, "Grace time (minutes)", "Tolérance de retard (minutes)")} value={draft.graceMinutes} max={180} suffix={fr ? "min" : "min"} onChange={(value) => number("graceMinutes", value)} /><p className="text-xs text-ink-muted">{t(fr, "The attendance terminal marks late/present status; this value is documented here for the company rule.", "Le terminal de présence définit le statut retard/présent ; cette valeur documente la règle de l’entreprise.")}</p></div></div></div><div className="rounded-xl border border-border bg-surface-2/65 p-4"><h3 className="font-semibold text-ink">{t(fr, "Confirmed conduct deductions", "Déductions de conduite confirmées")}</h3><p className="mt-1 text-xs text-ink-secondary">{t(fr, "Only upheld or closed disciplinary actions are considered. Open reports do not lower a score.", "Seules les décisions disciplinaires confirmées ou clôturées sont prises en compte. Les signalements ouverts ne diminuent pas le score.")}</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><PolicyNumber label={t(fr, "Minor action", "Action mineure")} value={draft.minorDeduction} onChange={(value) => number("minorDeduction", value)} /><PolicyNumber label={t(fr, "Serious action", "Action sérieuse")} value={draft.seriousDeduction} onChange={(value) => number("seriousDeduction", value)} /><PolicyNumber label={t(fr, "Gross action", "Action grave")} value={draft.grossDeduction} onChange={(value) => number("grossDeduction", value)} /><PolicyNumber label={t(fr, "Flagged report", "Rapport signalé")} value={draft.flaggedReportDeduction} onChange={(value) => number("flaggedReportDeduction", value)} /></div></div>{error ? <p className="text-sm text-critical" role="alert">{error}</p> : null}<div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="secondary" onClick={onClose}>{t(fr, "Cancel", "Annuler")}</Button><Button type="submit" loading={mutation.isPending} disabled={Math.abs(total - 100) > .001 || !draft.workingDays.length}><SlidersHorizontal />{t(fr, "Save rules", "Enregistrer les règles")}</Button></div></form></Dialog>;
}
function PolicyNumber({ label, value, onChange, max = 100, suffix = "%" }: { label: string; value: number; onChange: (value: string) => void; max?: number; suffix?: string }) { return <label className="grid gap-1.5 text-xs font-medium text-ink-secondary"><span>{label}</span><div className="relative"><input className={dateInput + (suffix ? " pr-9" : "")} type="number" min="0" max={max} step="1" value={value} onChange={(event) => onChange(event.target.value)} />{suffix ? <span className="absolute right-3 top-2.5 text-xs text-ink-muted">{suffix}</span> : null}</div></label>; }