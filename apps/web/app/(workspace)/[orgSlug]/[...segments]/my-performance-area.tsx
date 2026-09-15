"use client";

import { useQuery } from "@tanstack/react-query";
import { Award, CalendarDays, CheckCircle2, ClipboardCheck, FileWarning, ListChecks, Target, TimerReset } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ErrorState, EmptyState, SkeletonCard } from "@/components/ui/states";
import { get, orgUrl } from "@/lib/api";
import { useLanguage } from "@/providers/language-provider";

type Level = "not_enough_data" | "excellent" | "good" | "medium" | "needs_improvement" | "critical";
type Review = { id: string; periodStart: string; periodEnd: string; reviewType: string; overallRating?: number | null; strengths?: string | null; areasToImprove?: string | null; status: "draft" | "submitted" | "acknowledged" | "closed"; goalCount: number; achievedGoalCount: number; };
type Score = { score: number | null; level: Level; provisional: boolean; observations: number; issues: string[]; attendance: { scheduledDays: number; presentDays: number; lateDays: number }; dailyReports: { expected: number; submitted: number }; tasks: { assigned: number; completed: number }; };
type MyPerformance = { period: { from: string; to: string }; employees: Score[]; reviews: Review[]; generatedAt: string; };

const copy = (fr: boolean, english: string, french: string) => fr ? french : english;
const words = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const day = (value: string, locale: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(`${value.slice(0, 10)}T12:00:00`));

function levelText(level: Level, fr: boolean) { return { excellent: copy(fr, "Excellent", "Excellent"), good: copy(fr, "Good", "Bon"), medium: copy(fr, "Average", "Moyen"), needs_improvement: copy(fr, "Needs improvement", "À améliorer"), critical: copy(fr, "Critical", "Critique"), not_enough_data: copy(fr, "More data needed", "Données à compléter") }[level]; }
function levelVariant(level: Level) { if (level === "excellent" || level === "good") return "good" as const; if (level === "medium") return "info" as const; if (level === "needs_improvement" || level === "critical") return "warning" as const; return "outline" as const; }
function reviewVariant(status: Review["status"]) { if (status === "acknowledged" || status === "closed") return "good" as const; if (status === "submitted") return "info" as const; return "warning" as const; }
function issueText(issue: string, fr: boolean) {
  const text: Record<string, [string, string]> = {
    missing_attendance: ["Some scheduled days do not yet have an attendance record.", "Certaines journées prévues n’ont pas encore de présence enregistrée."],
    absent_days: ["Absences recorded during this period affect the score.", "Des absences enregistrées pendant cette période influencent le score."],
    late_arrivals: ["Late arrivals recorded during this period affect punctuality.", "Des retards enregistrés pendant cette période influencent la ponctualité."],
    missing_daily_reports: ["Some expected daily reports are still missing.", "Certains rapports quotidiens attendus sont encore manquants."],
    overdue_tasks: ["One or more assigned tasks are overdue.", "Une ou plusieurs tâches affectées sont en retard."],
    disciplinary_actions: ["A confirmed conduct decision affects this period.", "Une décision disciplinaire confirmée influence cette période."],
    flagged_reports: ["A daily report needs follow-up.", "Un rapport quotidien demande un suivi."],
  };
  const item = text[issue]; return item ? (fr ? item[1] : item[0]) : words(issue);
}
function Metric({ icon: Icon, label, value, note }: { icon: typeof CalendarDays; label: string; value: string; note: string }) {
  return <article className="rounded-2xl border border-border bg-surface-1 p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><span className="grid size-9 place-items-center rounded-xl border border-brand/15 bg-brand/10 text-brand"><Icon className="size-4" aria-hidden /></span><p className="text-right text-2xl font-semibold tracking-tight text-ink">{value}</p></div><p className="mt-4 text-xs font-semibold text-ink-secondary">{label}</p><p className="mt-1 text-xs leading-5 text-ink-muted">{note}</p></article>;
}

/** Personal view. The API derives employee identity from the authenticated membership. */
export function MyPerformanceArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const fr = locale.startsWith("fr");
  const performance = useQuery({ queryKey: ["my-performance", orgSlug], queryFn: () => get<MyPerformance>(orgUrl(orgSlug, "my-performance")) });

  if (performance.isPending) return <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8"><SkeletonCard rows={8} /></main>;
  if (performance.isError) return <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8"><ErrorState title={copy(fr, "Could not load your performance", "Impossible de charger votre performance")} description={performance.error instanceof Error ? performance.error.message : undefined} onRetry={() => void performance.refetch()} /></main>;

  const data = performance.data!;
  const score = data.employees[0] ?? null;
  const period = `${day(data.period.from, locale)} – ${day(data.period.to, locale)}`;
  return <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
    <header className="relative overflow-hidden rounded-3xl border border-border bg-surface-1 bg-linear-to-br from-brand/12 to-transparent px-5 py-7 shadow-md sm:px-7 sm:py-8"><div className="relative max-w-3xl"><p className="text-xs font-semibold uppercase tracking-[.16em] text-brand">{copy(fr, "My progress", "Mon évolution")}</p><h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{copy(fr, "My performance", "Ma performance")}</h1><p className="mt-2 text-sm leading-6 text-ink-secondary">{copy(fr, "Your score is calculated from your recorded attendance, daily reports, assigned work and confirmed conduct decisions.", "Votre score est calculé à partir de votre présence enregistrée, de vos rapports quotidiens, de vos tâches affectées et des décisions disciplinaires confirmées.")}</p><p className="mt-3 inline-flex rounded-full border border-border bg-surface-1 px-3 py-1 text-xs font-medium text-ink-secondary"><CalendarDays className="mr-1.5 size-3.5 text-brand" aria-hidden />{period}</p></div></header>
    {!score ? <section className="rounded-2xl border border-border bg-surface-1 shadow-sm"><EmptyState icon={Award} title={copy(fr, "No performance data yet", "Aucune donnée de performance pour le moment")} description={copy(fr, "Your score will appear once attendance, reports or assigned work have been recorded.", "Votre score apparaîtra dès que la présence, les rapports ou les tâches affectées auront été enregistrés.")} /></section> : <>
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1.95fr)]">
        <article className="overflow-hidden rounded-2xl border border-brand/25 bg-brand/5 p-5 shadow-sm"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-brand">{copy(fr, "Verified score", "Score vérifié")}</p><p className="mt-3 text-5xl font-semibold tracking-[-.06em] text-ink">{score.score === null ? "—" : `${Math.round(score.score)}%`}</p></div><span className="grid size-11 place-items-center rounded-2xl bg-brand text-brand-ink shadow-sm"><Award className="size-5" aria-hidden /></span></div><div className="mt-5 flex flex-wrap items-center gap-2"><Badge variant={levelVariant(score.level)}>{levelText(score.level, fr)}</Badge>{score.provisional ? <Badge variant="outline">{copy(fr, "Provisional", "Provisoire")}</Badge> : null}</div><p className="mt-4 text-xs leading-5 text-ink-secondary">{score.score === null ? copy(fr, "More recorded activity is needed before an official score can be calculated.", "Plus d’activité enregistrée est nécessaire avant le calcul d’un score officiel.") : copy(fr, `${score.observations} operational observations are included in this period.`, `${score.observations} observations opérationnelles sont prises en compte pour cette période.`)}</p></article>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={CalendarDays} label={copy(fr, "Attendance", "Présence")} value={`${score.attendance.presentDays + score.attendance.lateDays}/${score.attendance.scheduledDays}`} note={copy(fr, "days recorded", "jours enregistrés")} /><Metric icon={ClipboardCheck} label={copy(fr, "Daily reports", "Rapports quotidiens")} value={`${score.dailyReports.submitted}/${score.dailyReports.expected}`} note={copy(fr, "submitted", "soumis")} /><Metric icon={ListChecks} label={copy(fr, "Assigned work", "Tâches affectées")} value={`${score.tasks.completed}/${score.tasks.assigned}`} note={copy(fr, "completed", "terminées")} /><Metric icon={TimerReset} label={copy(fr, "Punctuality", "Ponctualité")} value={String(score.attendance.lateDays)} note={copy(fr, "late arrival(s)", "retard(s)")} /></div>
      </section>
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,.9fr)]">
        <section className="overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-sm"><div className="border-b border-border bg-linear-to-br from-brand/8 to-transparent px-5 py-4"><div className="flex items-start gap-3"><Target className="mt-0.5 size-5 text-brand" aria-hidden /><div><h2 className="text-base font-semibold text-ink">{copy(fr, "What to focus on", "Ce qui demande votre attention")}</h2><p className="mt-1 text-xs leading-5 text-ink-secondary">{copy(fr, "Only items already recorded in LiteHubs are shown here.", "Seuls les éléments déjà enregistrés dans LiteHubs apparaissent ici.")}</p></div></div></div>{score.issues.length ? <ul className="divide-y divide-border">{score.issues.map((item) => <li key={item} className="flex gap-3 px-5 py-4"><FileWarning className="mt-0.5 size-4 shrink-0 text-warning-ink" aria-hidden /><p className="text-sm leading-6 text-ink-secondary">{issueText(item, fr)}</p></li>)}</ul> : <EmptyState icon={CheckCircle2} title={copy(fr, "No issue recorded", "Aucun point de vigilance enregistré")} description={copy(fr, "Keep your attendance, daily reports and assigned work up to date.", "Continuez à tenir à jour votre présence, vos rapports quotidiens et vos tâches affectées.")} />}</section>
        <section className="overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-sm"><div className="border-b border-border px-5 py-4"><div className="flex items-start gap-3"><ClipboardCheck className="mt-0.5 size-5 text-brand" aria-hidden /><div><h2 className="text-base font-semibold text-ink">{copy(fr, "My reviews", "Mes évaluations")}</h2><p className="mt-1 text-xs leading-5 text-ink-secondary">{copy(fr, "Feedback shared by your manager.", "Retours partagés par votre responsable.")}</p></div></div></div>{data.reviews.length ? <div className="divide-y divide-border">{data.reviews.map((review) => <article key={review.id} className="space-y-2 px-5 py-4"><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-ink">{words(review.reviewType)}</p><Badge variant={reviewVariant(review.status)}>{words(review.status)}</Badge>{review.overallRating ? <Badge variant="outline" icon={false}>{review.overallRating}/5</Badge> : null}</div><p className="text-xs text-ink-muted">{day(review.periodStart, locale)} – {day(review.periodEnd, locale)}</p>{review.strengths ? <p className="text-sm leading-6 text-ink-secondary"><span className="font-medium text-ink">{copy(fr, "Strengths: ", "Points forts : ")}</span>{review.strengths}</p> : null}{review.areasToImprove ? <p className="text-sm leading-6 text-ink-secondary"><span className="font-medium text-ink">{copy(fr, "To improve: ", "À améliorer : ")}</span>{review.areasToImprove}</p> : null}{review.goalCount ? <p className="text-xs text-ink-muted">{review.achievedGoalCount}/{review.goalCount} {copy(fr, "goals achieved", "objectifs atteints")}</p> : null}</article>)}</div> : <EmptyState icon={ClipboardCheck} title={copy(fr, "No review yet", "Aucune évaluation pour le moment")} description={copy(fr, "Your completed performance reviews will appear here.", "Vos évaluations de performance apparaîtront ici une fois partagées.")} />}</section>
      </section>
    </>}
  </main>;
}
