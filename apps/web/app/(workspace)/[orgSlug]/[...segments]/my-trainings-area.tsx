"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Award,
  BookOpenCheck,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  FileText,
  Loader2,
  PlayCircle,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import {
  EmptyState,
  ErrorState,
  NoAccessState,
  SkeletonCard,
} from "@/components/ui/states";
import { ApiError, get, orgApiUrl, orgUrl, patch, post } from "@/lib/api";
import { can } from "@/lib/permissions";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";

type Status =
  | "assigned"
  | "in_progress"
  | "awaiting_review"
  | "completed"
  | "overdue"
  | "waived";
type Assignment = {
  id: string;
  status: Status;
  assignedOn: string;
  dueOn?: string | null;
  startedOn?: string | null;
  completedOn?: string | null;
  submittedOn?: string | null;
  progressPercent: number;
  course: {
    id: string;
    code: string;
    name: string;
    category: string;
    description?: string | null;
    isMandatory: boolean;
    requiresAcknowledgment?: boolean;
  };
};
type Question = { id: string; question: string; options: string[] };
type Lesson = {
  id: string;
  title: string;
  description?: string | null;
  materialType: "document" | "video" | "link" | "assessment" | "other";
  externalUrl?: string | null;
  documentId?: string | null;
  isRequired: boolean;
  requiresAcknowledgment: boolean;
  estimatedDurationMinutes?: number | null;
  progress: {
    startedAt?: string | null;
    lastOpenedAt?: string | null;
    completedAt?: string | null;
    acknowledgedAt?: string | null;
    quizScore?: number | null;
  };
  quiz?: { questions: Question[]; passingScore: number } | null;
};
type Detail = { assignment: Assignment; materials: Lesson[] };
type Certificate = {
  certificate: {
    certificateNumber?: string | null;
    completedOn: string;
    expiresOn?: string | null;
  } | null;
};
type ProfessionalBlock = {
  id: string;
  type: string;
  title?: string | null;
  content: Record<string, unknown>;
  documentId?: string | null;
  externalUrl?: string | null;
  captions?: string | null;
  transcript?: string | null;
  minimumWatchedPercent: number;
  allowDownload: boolean;
  sortOrder: number;
  isRequired: boolean;
  progress: {
    openedAt?: string | null;
    completedAt?: string | null;
    acknowledgedAt?: string | null;
    checklistState?: unknown;
    responseText?: string | null;
    watchedSeconds?: number | null;
    videoPositionSeconds?: number | null;
  };
};
type ProfessionalLesson = {
  id: string;
  title: string;
  summary?: string | null;
  estimatedDurationMinutes?: number | null;
  required: boolean;
  sequential: boolean;
  completionMode: string;
  progress: {
    status: string;
    completedAt?: string | null;
    lastOpenedAt?: string | null;
    lastBlockId?: string | null;
    videoPositionSeconds?: number | null;
  };
  blocks: ProfessionalBlock[];
};
type ProfessionalCourseDetail = {
  assignment: {
    id: string;
    status: Status;
    dueOn?: string | null;
    progressPercent: number;
    course: {
      id: string;
      name: string;
      code: string;
      category: string;
      summary?: string | null;
      validityMonths?: number | null;
      completionMode: string;
    };
  };
  modules: Array<{
    id: string;
    title: string;
    introduction?: string | null;
    summary?: string | null;
    lessons: ProfessionalLesson[];
  }>;
};

const label = (fr: boolean, english: string, french: string) =>
  fr ? french : english;
const words = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const date = (value: string | null | undefined, fr: boolean) =>
  value
    ? new Intl.DateTimeFormat(fr ? "fr-FR" : "en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(`${value.slice(0, 10)}T00:00:00`))
    : "—";
const statusText = (status: Status, fr: boolean) =>
  ({
    assigned: label(fr, "To do", "À faire"),
    in_progress: label(fr, "In progress", "En cours"),
    awaiting_review: label(
      fr,
      "Awaiting validation",
      "En attente de validation",
    ),
    completed: label(fr, "Completed", "Terminée"),
    overdue: label(fr, "Overdue", "En retard"),
    waived: label(fr, "Waived", "Dispensée"),
  })[status];
const statusVariant = (
  status: Status,
): "good" | "warning" | "serious" | "info" | "outline" =>
  status === "completed"
    ? "good"
    : status === "overdue"
      ? "serious"
      : status === "in_progress"
        ? "info"
        : status === "awaiting_review"
          ? "warning"
          : "outline";
const errorText = (error: unknown, fr: boolean) =>
  error instanceof ApiError
    ? (Object.values(error.fieldErrors).flat()[0] ?? error.message)
    : label(
        fr,
        "Unable to complete that action.",
        "Impossible d’effectuer cette action.",
      );

export function MyTrainingsArea({
  orgSlug,
  assignmentId,
}: {
  orgSlug: string;
  assignmentId?: string;
}) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const user = useSessionUser();
  const canRead = can(user, "training.read");
  const canUpdate = can(user, "training.update");
  if (!canRead)
    return (
      <NoAccessState what={label(fr, "your training", "vos formations")} />
    );
  return assignmentId ? (
    <TrainingReader
      orgSlug={orgSlug}
      assignmentId={assignmentId}
      fr={fr}
      canUpdate={canUpdate}
    />
  ) : (
    <MyTrainingList orgSlug={orgSlug} fr={fr} canUpdate={canUpdate} />
  );
}

function MyTrainingList({
  orgSlug,
  fr,
  canUpdate,
}: {
  orgSlug: string;
  fr: boolean;
  canUpdate: boolean;
}) {
  const [tab, setTab] = useState<
    "todo" | "in_progress" | "completed" | "overdue"
  >("todo");
  const trainings = useQuery({
    queryKey: ["my-trainings", orgSlug],
    queryFn: () =>
      get<{ assignments: Assignment[] }>(orgUrl(orgSlug, "my-trainings")),
    select: (data) => data.assignments,
  });
  const filtered = useMemo(
    () =>
      (trainings.data ?? []).filter((item) =>
        tab === "todo"
          ? item.status === "assigned"
          : tab === "in_progress"
            ? ["in_progress", "awaiting_review"].includes(item.status)
            : tab === "completed"
              ? ["completed", "waived"].includes(item.status)
              : item.status === "overdue",
      ),
    [trainings.data, tab],
  );
  if (trainings.isPending)
    return (
      <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
        <SkeletonCard rows={9} />
      </main>
    );
  if (trainings.isError)
    return (
      <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
        <ErrorState
          description={errorText(trainings.error, fr)}
          onRetry={() => void trainings.refetch()}
        />
      </main>
    );
  const tabs = [
    ["todo", label(fr, "To do", "À faire")],
    ["in_progress", label(fr, "In progress", "En cours")],
    ["completed", label(fr, "Completed", "Terminées")],
    ["overdue", label(fr, "Overdue", "En retard")],
  ] as const;
  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <header className="relative overflow-hidden rounded-3xl border border-indigo-300/20 bg-[radial-gradient(circle_at_85%_15%,rgba(108,147,255,.35),transparent_28%),linear-gradient(135deg,#102b55,#26458c_58%,#6643ae)] px-5 py-7 text-white shadow-[0_24px_52px_-36px_rgba(13,36,85,.95)] sm:px-7">
        <BookOpenCheck className="size-7 text-indigo-100" />
        <p className="mt-5 text-xs font-semibold uppercase tracking-[.18em] text-indigo-100">
          {label(fr, "My learning", "Mon apprentissage")}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          {label(fr, "My training", "Mes formations")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-indigo-50/90">
          {label(
            fr,
            "Follow your assigned lessons, keep your progress and submit completed learning for validation.",
            "Suivez vos leçons affectées, conservez votre progression et soumettez les formations terminées à validation.",
          )}
        </p>
      </header>
      <nav className="flex gap-1 overflow-x-auto rounded-2xl border border-border bg-surface-1 p-1.5 shadow-sm">
        {tabs.map(([value, text]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`min-w-max rounded-xl px-4 py-2.5 text-sm font-semibold transition ${tab === value ? "bg-brand text-white shadow-sm" : "text-ink-secondary hover:bg-surface-2 hover:text-ink"}`}
          >
            {text}
          </button>
        ))}
      </nav>
      {filtered.length ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((assignment) => (
            <TrainingCard
              key={assignment.id}
              assignment={assignment}
              orgSlug={orgSlug}
              fr={fr}
              canUpdate={canUpdate}
            />
          ))}
        </section>
      ) : (
        <EmptyState
          icon={BookOpenCheck}
          title={label(
            fr,
            "Nothing in this view",
            "Aucune formation dans cette vue",
          )}
          description={label(
            fr,
            "Your manager will assign learning here when it is required.",
            "Votre responsable affectera ici les formations nécessaires.",
          )}
        />
      )}
    </main>
  );
}

function TrainingCard({
  assignment,
  orgSlug,
  fr,
  canUpdate,
}: {
  assignment: Assignment;
  orgSlug: string;
  fr: boolean;
  canUpdate: boolean;
}) {
  const client = useQueryClient();
  const router = useRouter();
  const href = `/${orgSlug}/my-trainings/${assignment.id}`;
  const start = useMutation({
    mutationFn: () =>
      post<Detail>(orgUrl(orgSlug, `my-trainings/${assignment.id}/start`)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["my-trainings", orgSlug] });
      router.push(href);
    },
  });
  const action =
    assignment.status === "assigned" || assignment.status === "overdue"
      ? label(fr, "Start", "Commencer")
      : label(fr, "Continue", "Continuer");
  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="h-1 bg-gradient-to-r from-brand via-indigo-500 to-violet-500" />
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-brand/10 text-brand">
            <BookOpenCheck className="size-5" />
          </span>
          <Badge variant={statusVariant(assignment.status)}>
            {statusText(assignment.status, fr)}
          </Badge>
        </div>
        <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-brand">
          {words(assignment.course.category)}
        </p>
        <h2 className="mt-1 line-clamp-2 text-lg font-semibold text-ink">
          {assignment.course.name}
        </h2>
        <div className="mt-3 flex items-center gap-2 text-xs text-ink-secondary">
          {assignment.course.isMandatory ? (
            <Badge variant="warning">
              {label(fr, "Required", "Obligatoire")}
            </Badge>
          ) : (
            <Badge variant="outline">
              {label(fr, "Optional", "Facultative")}
            </Badge>
          )}
          <span>
            {label(fr, "Due", "Échéance")} : {date(assignment.dueOn, fr)}
          </span>
        </div>
        <div className="mt-5">
          <div className="flex justify-between text-xs text-ink-secondary">
            <span>{label(fr, "Progress", "Progression")}</span>
            <b className="text-ink">{assignment.progressPercent}%</b>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-brand transition-[width]"
              style={{ width: `${assignment.progressPercent}%` }}
            />
          </div>
        </div>
        <div className="mt-5 flex gap-2">
          {canUpdate &&
          (assignment.status === "assigned" ||
            assignment.status === "overdue") ? (
            <Button
              className="flex-1"
              loading={start.isPending}
              onClick={() => start.mutate()}
            >
              {action}
            </Button>
          ) : null}
          <Link
            href={href}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-surface-2 px-4 text-sm font-medium text-ink transition hover:bg-surface-3"
          >
            {assignment.status === "awaiting_review"
              ? label(fr, "View", "Consulter")
              : label(fr, "Open course", "Ouvrir le cours")}
            <ChevronRight className="size-4" />
          </Link>
        </div>
        {start.isError ? (
          <p className="mt-3 text-xs text-critical">
            {errorText(start.error, fr)}
          </p>
        ) : null}
      </div>
    </article>
  );
}

function TrainingReader({
  orgSlug,
  assignmentId,
  fr,
  canUpdate,
}: {
  orgSlug: string;
  assignmentId: string;
  fr: boolean;
  canUpdate: boolean;
}) {
  const client = useQueryClient();
  const [lessonIndex, setLessonIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const detail = useQuery({
    queryKey: ["my-training", orgSlug, assignmentId],
    queryFn: () => get<Detail>(orgUrl(orgSlug, `my-trainings/${assignmentId}`)),
  });
  const professional = useQuery({
    queryKey: ["professional-my-training", orgSlug, assignmentId],
    queryFn: () =>
      get<ProfessionalCourseDetail>(
        orgUrl(orgSlug, `my-trainings/${assignmentId}/course`),
      ),
    retry: false,
  });
  const refresh = () => {
    // The professional reader has its own detailed query. Refresh it together
    // with the legacy detail/list caches so progress changes are visible now.
    void client.invalidateQueries({
      queryKey: ["my-training", orgSlug, assignmentId],
    });
    void client.invalidateQueries({
      queryKey: ["professional-my-training", orgSlug, assignmentId],
    });
    void client.invalidateQueries({ queryKey: ["my-trainings", orgSlug] });
  };
  const start = useMutation({
    mutationFn: () =>
      post<Detail>(orgUrl(orgSlug, `my-trainings/${assignmentId}/start`)),
    onSuccess: refresh,
  });
  const updateLesson = useMutation({
    mutationFn: ({
      materialId,
      body,
    }: {
      materialId: string;
      body: Record<string, unknown>;
    }) =>
      patch<Detail>(
        orgUrl(
          orgSlug,
          `my-trainings/${assignmentId}/materials/${materialId}/progress`,
        ),
        body,
      ),
    onSuccess: refresh,
  });
  const submit = useMutation({
    mutationFn: () =>
      post<Detail>(orgUrl(orgSlug, `my-trainings/${assignmentId}/submit`)),
    onSuccess: refresh,
  });
  const certificate = useQuery({
    queryKey: ["my-training-certificate", orgSlug, assignmentId],
    queryFn: () =>
      get<Certificate>(
        orgUrl(orgSlug, `my-trainings/${assignmentId}/certificate`),
      ),
    enabled: detail.data?.assignment.status === "completed",
  });
  if (detail.isPending)
    return (
      <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
        <SkeletonCard rows={12} />
      </main>
    );
  if (detail.isError || !detail.data)
    return (
      <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
        <ErrorState
          description={errorText(detail.error, fr)}
          onRetry={() => void detail.refetch()}
        />
      </main>
    );
  if (professional.data?.modules.some((module) => module.lessons.length))
    return (
      <ProfessionalTrainingReader
        orgSlug={orgSlug}
        assignmentId={assignmentId}
        fr={fr}
        canUpdate={canUpdate}
        course={professional.data}
        onRefresh={refresh}
      />
    );
  const { assignment, materials } = detail.data;
  const lesson =
    materials[Math.min(lessonIndex, Math.max(materials.length - 1, 0))];
  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <Link
        href={`/${orgSlug}/my-trainings`}
        className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline"
      >
        <ArrowLeft className="size-4" />
        {label(fr, "My training", "Mes formations")}
      </Link>
      <header className="rounded-3xl border border-border bg-surface-1 p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand">
              {words(assignment.course.category)}
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
              {assignment.course.name}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">
              {assignment.course.description ??
                label(
                  fr,
                  "Complete each required lesson, then submit the training for validation.",
                  "Terminez chaque leçon requise, puis soumettez la formation à validation.",
                )}
            </p>
          </div>
          <Badge variant={statusVariant(assignment.status)}>
            {statusText(assignment.status, fr)}
          </Badge>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Stat
            text={label(fr, "Progress", "Progression")}
            value={`${assignment.progressPercent}%`}
          />
          <Stat
            text={label(fr, "Deadline", "Échéance")}
            value={date(assignment.dueOn, fr)}
          />
          <Stat
            text={label(fr, "Lessons", "Leçons")}
            value={`${materials.filter((item) => item.progress.completedAt).length}/${materials.length}`}
          />
        </div>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full rounded-full bg-brand"
            style={{ width: `${assignment.progressPercent}%` }}
          />
        </div>
      </header>
      {assignment.status === "assigned" || assignment.status === "overdue" ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand/25 bg-brand/5 p-4">
          <p className="text-sm text-ink-secondary">
            {label(
              fr,
              "Start this training to save your learning progress.",
              "Démarrez cette formation pour enregistrer votre progression.",
            )}
          </p>
          <Button
            loading={start.isPending}
            disabled={!canUpdate}
            onClick={() => start.mutate()}
          >
            {label(fr, "Start training", "Démarrer la formation")}
          </Button>
          {start.isError ? (
            <p className="w-full text-xs text-critical">
              {errorText(start.error, fr)}
            </p>
          ) : null}
        </section>
      ) : null}
      {materials.length && lesson ? (
        <section className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-border bg-surface-1 p-3 shadow-sm">
            <p className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {label(fr, "Course lessons", "Leçons du parcours")}
            </p>
            <div className="space-y-1">
              {materials.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setLessonIndex(index);
                    if (
                      canUpdate &&
                      ["in_progress", "overdue"].includes(assignment.status) &&
                      !item.progress.completedAt
                    )
                      updateLesson.mutate({
                        materialId: item.id,
                        body: { opened: true },
                      });
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl p-3 text-left ${index === lessonIndex ? "bg-brand/10 text-brand" : "text-ink-secondary hover:bg-surface-2"}`}
                >
                  <span
                    className={`grid size-6 shrink-0 place-items-center rounded-full text-xs ${item.progress.completedAt ? "bg-good text-white" : "bg-surface-3 text-ink-muted"}`}
                  >
                    {item.progress.completedAt ? (
                      <CheckCircle2 className="size-3.5" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {item.title}
                  </span>
                  {item.isRequired ? (
                    <span className="text-[10px] font-semibold uppercase">
                      *
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </aside>
          <div className="space-y-3">
            <LessonReader
              orgSlug={orgSlug}
              assignmentId={assignmentId}
              lesson={lesson}
              fr={fr}
              disabled={
                !canUpdate ||
                ["assigned", "awaiting_review", "completed", "waived"].includes(
                  assignment.status,
                )
              }
              answers={answers}
              setAnswers={setAnswers}
              onUpdate={(body) =>
                updateLesson.mutate({ materialId: lesson.id, body })
              }
              loading={updateLesson.isPending}
              error={
                updateLesson.isError ? errorText(updateLesson.error, fr) : null
              }
            />
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-1 p-3 shadow-sm">
              <Button
                type="button"
                variant="secondary"
                disabled={lessonIndex === 0}
                onClick={() =>
                  setLessonIndex((index) => Math.max(0, index - 1))
                }
              >
                <ArrowLeft className="size-4" />
                {label(fr, "Previous", "Précédent")}
              </Button>
              <span className="text-xs font-medium text-ink-muted">
                {lessonIndex + 1} / {materials.length}
              </span>
              <Button
                type="button"
                variant="secondary"
                disabled={lessonIndex >= materials.length - 1}
                onClick={() =>
                  setLessonIndex((index) =>
                    Math.min(materials.length - 1, index + 1),
                  )
                }
              >
                {label(fr, "Next", "Suivant")}
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>
        </section>
      ) : (
        <EmptyState
          icon={FileText}
          title={label(fr, "No lessons yet", "Aucune leçon pour le moment")}
          description={label(
            fr,
            "Your manager will add the training material before this course can be completed.",
            "Votre responsable ajoutera les supports avant que cette formation puisse être terminée.",
          )}
        />
      )}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-surface-1 p-5 shadow-sm">
        <div>
          <h2 className="text-base font-semibold text-ink">
            {label(fr, "Finish training", "Terminer la formation")}
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">
            {assignment.status === "awaiting_review"
              ? label(
                  fr,
                  "Your training is waiting for manager validation.",
                  "Votre formation attend la validation du responsable.",
                )
              : label(
                  fr,
                  "All required lessons, acknowledgments and quizzes must be completed before submission.",
                  "Toutes les leçons, reconnaissances et évaluations requises doivent être terminées avant la soumission.",
                )}
          </p>
        </div>
        {assignment.status === "in_progress" ||
        assignment.status === "overdue" ? (
          <Button
            loading={submit.isPending}
            disabled={!canUpdate}
            onClick={() => submit.mutate()}
          >
            <ShieldCheck />
            {label(fr, "Submit for validation", "Soumettre à validation")}
          </Button>
        ) : null}
        {assignment.status === "completed" && certificate.data?.certificate ? (
          <div className="rounded-xl bg-good/10 px-4 py-3 text-sm text-good-ink">
            <Award className="mr-2 inline size-4" />
            {label(fr, "Certificate available", "Certificat disponible")}{" "}
            {certificate.data.certificate.certificateNumber
              ? `· ${certificate.data.certificate.certificateNumber}`
              : ""}
          </div>
        ) : null}
        {submit.isError ? (
          <p className="w-full text-xs text-critical">
            {errorText(submit.error, fr)}
          </p>
        ) : null}
      </section>
    </main>
  );
}

function LessonReader({
  orgSlug,
  assignmentId,
  lesson,
  fr,
  disabled,
  answers,
  setAnswers,
  onUpdate,
  loading,
  error,
}: {
  orgSlug: string;
  assignmentId: string;
  lesson: Lesson;
  fr: boolean;
  disabled: boolean;
  answers: Record<string, number>;
  setAnswers: (value: Record<string, number>) => void;
  onUpdate: (body: Record<string, unknown>) => void;
  loading: boolean;
  error: string | null;
}) {
  const secureContent = lesson.documentId
    ? orgApiUrl(
        orgSlug,
        `my-trainings/${assignmentId}/materials/${lesson.id}/content`,
      )
    : null;
  const video = lesson.materialType === "video";
  return (
    <article className="rounded-2xl border border-border bg-surface-1 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand">
            {words(lesson.materialType)}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-ink">
            {lesson.title}
          </h2>
          {lesson.description ? (
            <p className="mt-2 text-sm leading-6 text-ink-secondary">
              {lesson.description}
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          {lesson.isRequired ? (
            <Badge variant="warning">{label(fr, "Required", "Requis")}</Badge>
          ) : null}
          {lesson.progress.completedAt ? (
            <Badge variant="good">{label(fr, "Completed", "Terminée")}</Badge>
          ) : null}
        </div>
      </div>
      {lesson.estimatedDurationMinutes ? (
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-ink-muted">
          <Clock3 className="size-3.5" />
          {lesson.estimatedDurationMinutes} {label(fr, "min", "min")}
        </p>
      ) : null}
      <div className="mt-5 overflow-hidden rounded-xl border border-border bg-surface-2">
        {secureContent && video ? (
          <video
            className="aspect-video w-full bg-black"
            controls
            src={secureContent}
          />
        ) : secureContent ? (
          <iframe
            title={lesson.title}
            src={secureContent}
            className="h-[34rem] w-full bg-white"
          />
        ) : lesson.externalUrl && video ? (
          <video
            className="aspect-video w-full bg-black"
            controls
            src={lesson.externalUrl}
          />
        ) : lesson.externalUrl ? (
          <div className="flex min-h-48 flex-col items-center justify-center p-6 text-center">
            <ExternalLink className="size-7 text-brand" />
            <p className="mt-3 text-sm text-ink-secondary">
              {label(
                fr,
                "This lesson opens on an approved external learning site.",
                "Cette leçon s’ouvre sur un site de formation externe approuvé.",
              )}
            </p>
            <a
              className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-brand px-4 text-sm font-medium text-brand-ink"
              href={lesson.externalUrl}
              target="_blank"
              rel="noreferrer"
            >
              {label(fr, "Open lesson", "Ouvrir le support")}
              <ExternalLink className="size-4" />
            </a>
          </div>
        ) : (
          <div className="grid min-h-48 place-items-center text-sm text-ink-secondary">
            {label(
              fr,
              "No viewable material is attached.",
              "Aucun support consultable n’est joint.",
            )}
          </div>
        )}
      </div>
      {lesson.requiresAcknowledgment ? (
        <label className="mt-5 flex items-start gap-3 rounded-xl border border-border p-4 text-sm text-ink">
          <input
            type="checkbox"
            checked={Boolean(lesson.progress.acknowledgedAt)}
            disabled={disabled || loading}
            onChange={(event) =>
              event.target.checked && onUpdate({ acknowledged: true })
            }
          />
          <span>
            <b>
              {label(
                fr,
                "I acknowledge this lesson",
                "Je reconnais avoir lu cette leçon",
              )}
            </b>
            <span className="mt-1 block text-xs text-ink-secondary">
              {label(
                fr,
                "This acknowledgement is required before completion.",
                "Cette reconnaissance est requise avant la complétion.",
              )}
            </span>
          </span>
        </label>
      ) : null}
      {lesson.quiz?.questions.length ? (
        <section className="mt-5 rounded-xl border border-border p-4">
          <h3 className="font-semibold text-ink">
            {label(fr, "Knowledge check", "Vérification des acquis")}
          </h3>
          <p className="mt-1 text-xs text-ink-secondary">
            {label(
              fr,
              `Passing score: ${lesson.quiz.passingScore}%`,
              `Note de réussite : ${lesson.quiz.passingScore}%`,
            )}
          </p>
          <div className="mt-4 space-y-5">
            {lesson.quiz.questions.map((question) => (
              <fieldset key={question.id}>
                <legend className="text-sm font-medium text-ink">
                  {question.question}
                </legend>
                <div className="mt-2 space-y-2">
                  {question.options.map((option, index) => (
                    <label
                      key={`${question.id}-${index}`}
                      className="flex items-center gap-2 text-sm text-ink-secondary"
                    >
                      <input
                        type="radio"
                        name={question.id}
                        checked={answers[question.id] === index}
                        disabled={
                          disabled || Boolean(lesson.progress.completedAt)
                        }
                        onChange={() =>
                          setAnswers({ ...answers, [question.id]: index })
                        }
                      />
                      {option}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        </section>
      ) : null}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button
          loading={loading}
          disabled={disabled || Boolean(lesson.progress.completedAt)}
          onClick={() =>
            onUpdate(
              lesson.quiz?.questions.length
                ? {
                    completed: true,
                    quizAnswers: lesson.quiz.questions.map(
                      (question) => answers[question.id] ?? -1,
                    ),
                  }
                : { completed: true },
            )
          }
        >
          <CheckCircle2 />
          {lesson.quiz?.questions.length
            ? label(
                fr,
                "Submit quiz and complete",
                "Envoyer le quiz et terminer",
              )
            : label(fr, "Mark lesson complete", "Marquer la leçon terminée")}
        </Button>
        {lesson.progress.quizScore !== null &&
        lesson.progress.quizScore !== undefined ? (
          <span className="text-sm font-medium text-ink">
            {label(fr, "Quiz score", "Score du quiz")} :{" "}
            {lesson.progress.quizScore}%
          </span>
        ) : null}
        {error ? <p className="w-full text-xs text-critical">{error}</p> : null}
      </div>
    </article>
  );
}

function Stat({ text, value }: { text: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <p className="text-xs text-ink-muted">{text}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}
function ProfessionalTrainingReader({
  orgSlug,
  assignmentId,
  fr,
  canUpdate,
  course,
  onRefresh,
}: {
  orgSlug: string;
  assignmentId: string;
  fr: boolean;
  canUpdate: boolean;
  course: ProfessionalCourseDetail;
  onRefresh: () => void;
}) {
  const outline = course.modules.flatMap((module) =>
    module.lessons.map((lesson) => ({ module, lesson })),
  );
  const firstOpen = Math.max(
    0,
    outline.findIndex(({ lesson }) => lesson.progress.status !== "completed"),
  );
  const [lessonIndex, setLessonIndex] = useState(firstOpen < 0 ? 0 : firstOpen);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const heartbeatRef = useRef<Record<string, number>>({});
  const progress = useMutation({
    mutationFn: ({
      blockId,
      body,
    }: {
      blockId: string;
      body: Record<string, unknown>;
    }) =>
      patch(
        orgUrl(
          orgSlug,
          `my-trainings/${assignmentId}/blocks/${blockId}/progress`,
        ),
        body,
      ),
    onSuccess: onRefresh,
  });
  const quiz = useMutation({
    mutationFn: ({ blockId, values }: { blockId: string; values: unknown[] }) =>
      post(
        orgUrl(
          orgSlug,
          `my-trainings/${assignmentId}/blocks/${blockId}/quiz-attempts`,
        ),
        { answers: values },
      ),
    onSuccess: onRefresh,
  });
  const selected =
    outline[Math.min(lessonIndex, Math.max(0, outline.length - 1))];
  if (!selected)
    return (
      <EmptyState
        icon={BookOpenCheck}
        title={label(
          fr,
          "No professional lessons yet",
          "Aucune leçon professionnelle",
        )}
        description={label(
          fr,
          "The course is being prepared.",
          "Le cours est en préparation.",
        )}
      />
    );
  const { lesson, module } = selected;
  const requiredCount = outline.filter(
    ({ lesson: row }) => row.required,
  ).length;
  const completedCount = outline.filter(
    ({ lesson: row }) => row.required && row.progress.status === "completed",
  ).length;
  const openLesson = (index: number, row: ProfessionalLesson, closeOutline = false) => {
    setLessonIndex(index);
    if (closeOutline) setOutlineOpen(false);
    if (canUpdate) {
      const firstBlock = row.blocks[0];
      if (firstBlock) {
        progress.mutate({ blockId: firstBlock.id, body: { action: "open" } });
      }
    }
  };
  const outlineList = (compact = false) => (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {course.modules.map((outlineModule) => (
        <div key={outlineModule.id}>
          <p className="px-2 pb-1 text-xs font-semibold text-ink">
            {outlineModule.title}
          </p>
          <div className="space-y-1">
            {outlineModule.lessons.map((row) => {
              const index = outline.findIndex((item) => item.lesson.id === row.id);
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => openLesson(index, row, compact)}
                  className={`flex w-full items-center gap-3 rounded-xl p-3 text-left transition ${index === lessonIndex ? "bg-brand/10 text-brand" : "text-ink-secondary hover:bg-surface-2 hover:text-ink"}`}
                >
                  <span
                    className={`grid size-6 shrink-0 place-items-center rounded-full text-xs ${row.progress.status === "completed" ? "bg-good text-white" : "bg-surface-3 text-ink-muted"}`}
                  >
                    {row.progress.status === "completed" ? (
                      <CheckCircle2 className="size-3.5" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {row.title}
                  </span>
                  {row.required ? <span className="text-[10px] font-semibold">*</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <Link
        href={`/${orgSlug}/my-trainings`}
        className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline"
      >
        <ArrowLeft className="size-4" />
        {label(fr, "My training", "Mes formations")}
      </Link>
      <header className="relative overflow-hidden rounded-2xl border border-brand/20 bg-[radial-gradient(circle_at_87%_12%,rgba(129,140,248,.25),transparent_28%),linear-gradient(135deg,#102b55,#24488f_58%,#6643ae)] p-4 text-white shadow-[0_24px_52px_-36px_rgba(13,36,85,.95)] sm:rounded-3xl sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-indigo-100">
              {course.assignment.course.category}
            </p>
            <h1 className="mt-1.5 text-xl font-semibold tracking-tight sm:mt-2 sm:text-2xl">
              {course.assignment.course.name}
            </h1>
            <p className="mt-1.5 max-w-3xl line-clamp-2 text-sm leading-5 text-indigo-50/90 sm:mt-2 sm:line-clamp-none sm:leading-6">
              {course.assignment.course.summary ??
                label(
                  fr,
                  "Complete each required lesson and assessment to validate this course.",
                  "Terminez chaque leçon et évaluation requise pour valider ce parcours.",
                )}
            </p>
          </div>
          <Badge variant={statusVariant(course.assignment.status)}>
            {statusText(course.assignment.status, fr)}
          </Badge>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 sm:mt-6 sm:gap-3">
          <MetricCard
            fr={fr}
            labelEn="Official progress"
            labelFr="Progression vérifiée"
            value={`${course.assignment.progressPercent}%`}
          />
          <MetricCard
            fr={fr}
            labelEn="Lessons"
            labelFr="Leçons"
            value={`${completedCount}/${requiredCount}`}
          />
          <MetricCard
            fr={fr}
            labelEn="Deadline"
            labelFr="Échéance"
            value={date(course.assignment.dueOn, fr)}
          />
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/15 sm:mt-5 sm:h-2">
          <div
            className="h-full rounded-full bg-emerald-300 transition-[width]"
            style={{ width: `${course.assignment.progressPercent}%` }}
          />
        </div>
        <p className="mt-2 hidden text-xs text-indigo-100 sm:block">
          {label(
            fr,
            "Progress is saved securely as you complete required content.",
            "La progression est enregistrée de façon sécurisée à chaque contenu requis terminé.",
          )}
        </p>
      </header>
      <section className="grid gap-4 xl:grid-cols-[19rem_minmax(0,1fr)] xl:gap-5">
        <div>
          <details
            className="rounded-2xl border border-border bg-surface-1 p-3 shadow-sm xl:hidden"
            open={outlineOpen}
            onToggle={(event) => setOutlineOpen(event.currentTarget.open)}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-2 py-1 text-left marker:hidden">
              <span>
                <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  {label(fr, "Course outline", "Plan du cours")}
                </span>
                <span className="mt-1 block max-w-[15rem] truncate text-sm font-semibold text-ink">
                  {lessonIndex + 1}/{outline.length} · {lesson.title}
                </span>
              </span>
              <ChevronRight className={`size-5 shrink-0 text-brand transition-transform ${outlineOpen ? "rotate-90" : ""}`} />
            </summary>
            <div className="mt-3 max-h-[50vh] overflow-y-auto border-t border-border pt-3">
              {outlineList(true)}
            </div>
          </details>
          <aside className="hidden rounded-2xl border border-border bg-surface-1 p-3 shadow-sm xl:block">
            <p className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {label(fr, "Course outline", "Plan du cours")}
            </p>
            {outlineList()}
          </aside>
        </div>
        <article className="rounded-2xl border border-border bg-surface-1 p-5 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[.14em] text-brand">
                {module.title}
              </p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
                {lesson.title}
              </h2>
              {lesson.summary ? (
                <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">
                  {lesson.summary}
                </p>
              ) : null}
            </div>
            <div className="flex gap-2">
              {lesson.required ? (
                <Badge variant="warning">
                  {label(fr, "Required", "Requis")}
                </Badge>
              ) : null}
              {lesson.progress.status === "completed" ? (
                <Badge variant="good">
                  {label(fr, "Completed", "Terminée")}
                </Badge>
              ) : null}
            </div>
          </div>
          {lesson.estimatedDurationMinutes ? (
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-ink-muted">
              <Clock3 className="size-3.5" />
              {lesson.estimatedDurationMinutes} {label(fr, "min", "min")}
            </p>
          ) : null}
          <div className="mt-6 space-y-5">
            {lesson.blocks.map((block) => (
              <ProfessionalBlockReader
                key={block.id}
                block={block}
                orgSlug={orgSlug}
                assignmentId={assignmentId}
                fr={fr}
                disabled={
                  !canUpdate ||
                  ["completed", "awaiting_review", "waived"].includes(
                    course.assignment.status,
                  )
                }
                onProgress={(body) =>
                  progress.mutate({ blockId: block.id, body })
                }
                progressLoading={progress.isPending}
                onQuiz={(values) => quiz.mutate({ blockId: block.id, values })}
                quizLoading={quiz.isPending}
                answers={answers}
                setAnswers={setAnswers}
                heartbeatRef={heartbeatRef}
              />
            ))}
          </div>
          {progress.isError || quiz.isError ? (
            <p className="mt-4 text-sm text-critical">
              {errorText(progress.error ?? quiz.error, fr)}
            </p>
          ) : null}
          <div className="mt-7 flex items-center justify-between gap-3 border-t border-border pt-5">
            <Button
              type="button"
              variant="secondary"
              disabled={lessonIndex === 0}
              onClick={() => setLessonIndex((value) => Math.max(0, value - 1))}
            >
              <ArrowLeft className="size-4" />
              {label(fr, "Previous", "Précédent")}
            </Button>
            <span className="text-xs font-semibold text-ink-muted">
              {lessonIndex + 1} / {outline.length}
            </span>
            <Button
              type="button"
              variant="secondary"
              disabled={lessonIndex >= outline.length - 1}
              onClick={() =>
                setLessonIndex((value) =>
                  Math.min(outline.length - 1, value + 1),
                )
              }
            >
              {label(fr, "Next", "Suivant")}
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </article>
      </section>
      {course.assignment.status === "awaiting_review" ? (
        <section className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-ink">
          <ShieldCheck className="mr-2 inline size-4 text-warning-ink" />
          {label(
            fr,
            "Your completion is waiting for supervisor validation.",
            "Votre complétion attend la validation du responsable.",
          )}
        </section>
      ) : null}
      {course.assignment.status === "completed" ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-good/30 bg-good/10 p-4 text-sm text-good-ink">
          <span>
            <Award className="mr-2 inline size-4" />
            {label(
              fr,
              "Course completed. Your certificate is ready.",
              "Formation terminée. Votre certificat est prêt.",
            )}
          </span>
          <a
            href={orgApiUrl(
              orgSlug,
              `my-trainings/${assignmentId}/professional-certificate.pdf`,
            )}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-good px-3 text-sm font-semibold text-white"
          >
            <FileText className="size-4" />
            {label(fr, "Download certificate", "Télécharger le certificat")}
          </a>
        </section>
      ) : null}
    </main>
  );
}

function MetricCard({
  fr,
  labelEn,
  labelFr,
  value,
}: {
  fr: boolean;
  labelEn: string;
  labelFr: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-white/15 bg-white/10 p-2 sm:rounded-xl sm:p-3">
      <p className="truncate text-[10px] text-indigo-100 sm:text-xs">{fr ? labelFr : labelEn}</p>
      <p className="mt-0.5 truncate text-xs font-semibold text-white sm:mt-1 sm:text-sm">{value}</p>
    </div>
  );
}

function ProfessionalBlockReader({
  block,
  orgSlug,
  assignmentId,
  fr,
  disabled,
  onProgress,
  progressLoading,
  onQuiz,
  quizLoading,
  answers,
  setAnswers,
  heartbeatRef,
}: {
  block: ProfessionalBlock;
  orgSlug: string;
  assignmentId: string;
  fr: boolean;
  disabled: boolean;
  onProgress: (body: Record<string, unknown>) => void;
  progressLoading: boolean;
  onQuiz: (values: unknown[]) => void;
  quizLoading: boolean;
  answers: Record<string, unknown>;
  setAnswers: (value: Record<string, unknown>) => void;
  heartbeatRef: React.MutableRefObject<Record<string, number>>;
}) {
  const content = block.content ?? {};
  const body = String(
    content.body ?? content.text ?? content.description ?? "",
  );
  const items = Array.isArray(content.items)
    ? (content.items as Array<Record<string, unknown>>)
    : [];
  const questions = Array.isArray(content.questions)
    ? (content.questions as Array<Record<string, unknown>>)
    : [];
  const secureUrl = block.documentId
    ? orgApiUrl(
        orgSlug,
        `my-trainings/${assignmentId}/blocks/${block.id}/content`,
      )
    : null;
  const complete = Boolean(block.progress.completedAt);
  const action = (next: Record<string, unknown>) => onProgress(next);
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface-1">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-surface-2/60 px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand">
            {words(block.type)}
          </p>
          {block.title ? (
            <h3 className="mt-1 font-semibold text-ink">{block.title}</h3>
          ) : null}
        </div>
        {block.isRequired ? (
          <Badge variant="warning">{label(fr, "Required", "Requis")}</Badge>
        ) : null}
        {complete ? (
          <Badge variant="good">{label(fr, "Complete", "Terminé")}</Badge>
        ) : null}
      </div>
      <div className="p-4">
        {body ? (
          <p className="whitespace-pre-wrap text-sm leading-7 text-ink-secondary">
            {body}
          </p>
        ) : null}
        {block.type === "callout" ? (
          <div className="mt-3 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-ink">
            {String(content.message ?? body)}
          </div>
        ) : null}
        {secureUrl && block.type === "video" ? (
          <video
            className="mt-3 aspect-video w-full rounded-xl bg-black"
            controls
            controlsList={block.allowDownload ? undefined : "nodownload"}
            src={secureUrl}
            onTimeUpdate={(event) => {
              const current = Math.floor(event.currentTarget.currentTime);
              const last = heartbeatRef.current[block.id] ?? 0;
              if (current - last >= 12) {
                heartbeatRef.current[block.id] = current;
                action({ action: "heartbeat", videoPositionSeconds: current });
              }
            }}
            onPause={(event) =>
              action({
                action: "heartbeat",
                videoPositionSeconds: Math.floor(
                  event.currentTarget.currentTime,
                ),
              })
            }
          />
        ) : null}
        {secureUrl && block.type === "audio" ? (
          <audio
            className="mt-3 w-full"
            controls
            src={secureUrl}
            onTimeUpdate={(event) => {
              const current = Math.floor(event.currentTarget.currentTime);
              const last = heartbeatRef.current[block.id] ?? 0;
              if (current - last >= 12) {
                heartbeatRef.current[block.id] = current;
                action({ action: "heartbeat", videoPositionSeconds: current });
              }
            }}
          />
        ) : null}
        {secureUrl && ["document", "file", "image"].includes(block.type) ? (
          <iframe
            title={block.title ?? "Training document"}
            src={secureUrl}
            className="mt-3 h-[32rem] w-full rounded-xl border border-border bg-white"
          />
        ) : null}
        {block.externalUrl ? (
          <a
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-brand-ink"
            href={block.externalUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => action({ action: "open" })}
          >
            {label(fr, "Open secure resource", "Ouvrir le support sécurisé")}
            <ExternalLink className="size-4" />
          </a>
        ) : null}
        {block.transcript ? (
          <details className="mt-3 rounded-lg border border-border p-3 text-sm text-ink-secondary">
            <summary className="cursor-pointer font-semibold text-ink">
              {label(fr, "Transcript", "Transcription")}
            </summary>
            <p className="mt-2 whitespace-pre-wrap leading-6">
              {block.transcript}
            </p>
          </details>
        ) : null}
        {items.length ? (
          <div className="mt-4 space-y-2">
            {items.map((item, index) => {
              const id = String(item.id ?? index);
              const selected =
                Array.isArray(block.progress.checklistState) &&
                block.progress.checklistState.includes(id);
              return (
                <label
                  key={id}
                  className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm text-ink"
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={disabled || complete}
                    onChange={(event) => {
                      const current = Array.isArray(
                        block.progress.checklistState,
                      )
                        ? block.progress.checklistState.map(String)
                        : [];
                      const next = event.target.checked
                        ? [...new Set([...current, id])]
                        : current.filter((value) => value !== id);
                      action({ action: "checklist", checklistItemIds: next });
                    }}
                  />
                  <span>
                    {String(
                      item.label ??
                        item.text ??
                        item.title ??
                        `Step ${index + 1}`,
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        ) : null}
        {block.type === "acknowledgment" ? (
          <label className="mt-4 flex items-start gap-3 rounded-xl border border-brand/25 bg-brand/5 p-3 text-sm text-ink">
            <input
              type="checkbox"
              checked={Boolean(block.progress.acknowledgedAt)}
              disabled={disabled || complete}
              onChange={(event) =>
                event.target.checked && action({ action: "acknowledge" })
              }
            />
            <span>
              <b>
                {label(fr, "I have read and understood", "J’ai lu et compris")}
              </b>
              <span className="mt-1 block text-xs text-ink-secondary">
                {label(
                  fr,
                  "This acknowledgement is recorded with your course evidence.",
                  "Cet accusé de lecture est conservé avec vos preuves de formation.",
                )}
              </span>
            </span>
          </label>
        ) : null}
        {["reflection", "single_question"].includes(block.type) ? (
          <div className="mt-4">
            <Textarea
              value={String(
                answers[block.id] ?? block.progress.responseText ?? "",
              )}
              disabled={disabled || complete}
              placeholder={label(
                fr,
                "Write your response…",
                "Écrivez votre réponse…",
              )}
              onChange={(event) =>
                setAnswers({ ...answers, [block.id]: event.target.value })
              }
            />
            <Button
              className="mt-2"
              size="sm"
              disabled={
                disabled || complete || !String(answers[block.id] ?? "").trim()
              }
              loading={progressLoading}
              onClick={() =>
                action({
                  action: "response",
                  responseText: String(answers[block.id]),
                })
              }
            >
              {label(fr, "Save response", "Enregistrer la réponse")}
            </Button>
          </div>
        ) : null}
        {block.type === "quiz" && questions.length ? (
          <div className="mt-4 space-y-5 rounded-xl border border-border p-4">
            <h4 className="font-semibold text-ink">
              {label(fr, "Knowledge assessment", "Évaluation des acquis")}
            </h4>
            <p className="text-xs text-ink-secondary">
              {label(
                fr,
                `Passing score: ${String(content.passingScore ?? 70)}%`,
                `Note requise : ${String(content.passingScore ?? 70)}%`,
              )}
            </p>
            {questions.map((question, index) => {
              const key = `${block.id}:${String(question.id ?? index)}`;
              const options = Array.isArray(question.options)
                ? question.options
                : [];
              return (
                <fieldset key={key}>
                  <legend className="text-sm font-medium text-ink">
                    {String(
                      question.question ??
                        question.prompt ??
                        `Question ${index + 1}`,
                    )}
                  </legend>
                  <div className="mt-2 space-y-2">
                    {options.map((option, optionIndex) => (
                      <label
                        key={`${key}:${optionIndex}`}
                        className="flex items-center gap-2 text-sm text-ink-secondary"
                      >
                        <input
                          type={
                            question.type === "multiple_choice"
                              ? "checkbox"
                              : "radio"
                          }
                          name={key}
                          checked={
                            question.type === "multiple_choice"
                              ? Array.isArray(answers[key]) &&
                                (answers[key] as unknown[]).includes(
                                  optionIndex,
                                )
                              : answers[key] === optionIndex
                          }
                          disabled={disabled || complete}
                          onChange={(event) => {
                            const old = answers[key];
                            const next =
                              question.type === "multiple_choice"
                                ? event.target.checked
                                  ? [
                                      ...new Set([
                                        ...(Array.isArray(old) ? old : []),
                                        optionIndex,
                                      ]),
                                    ]
                                  : Array.isArray(old)
                                    ? old.filter(
                                        (value) => value !== optionIndex,
                                      )
                                    : []
                                : optionIndex;
                            setAnswers({ ...answers, [key]: next });
                          }}
                        />
                        {String(option)}
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
            <Button
              disabled={disabled || complete}
              loading={quizLoading}
              onClick={() =>
                onQuiz(
                  questions.map(
                    (question, index) =>
                      answers[`${block.id}:${String(question.id ?? index)}`] ??
                      null,
                  ),
                )
              }
            >
              <ShieldCheck className="size-4" />
              {label(fr, "Submit assessment", "Envoyer l’évaluation")}
            </Button>
          </div>
        ) : null}
        {!complete &&
        ![
          "quiz",
          "video",
          "audio",
          "acknowledgment",
          "checklist",
          "reflection",
          "single_question",
          "supervisor_verification",
        ].includes(block.type) ? (
          <Button
            className="mt-4"
            size="sm"
            disabled={disabled}
            loading={progressLoading}
            onClick={() => action({ action: "confirm" })}
          >
            <CheckCircle2 className="size-4" />
            {label(fr, "I have read and understood", "J’ai lu et compris")}
          </Button>
        ) : null}
        {block.type === "supervisor_verification" ? (
          <p className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-ink">
            {label(
              fr,
              "This lesson is waiting for a supervisor verification after your work is observed.",
              "Cette leçon attend la vérification d’un responsable après l’observation de votre travail.",
            )}
          </p>
        ) : null}
      </div>
    </section>
  );
}
