"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
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
  Maximize2,
  Minimize2,
  Pause,
  Play,
  PlayCircle,
  RotateCcw,
  ShieldCheck,
  Volume2,
  VolumeX,
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
import { ApiError, get, orgApiUrl, orgUrl, patch, post, put } from "@/lib/api";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";
import { useUiStore } from "@/stores/ui-store";

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
type QuizSubmissionResult = {
  score?: number | null;
  passingScore?: number | null;
  passed?: boolean | null;
  awaitingGrading?: boolean;
};
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
const errorText = (error: unknown, fr: boolean) => {
  if (error instanceof ApiError) {
    const message = Object.values(error.fieldErrors).flat()[0] ?? error.message;
    if (message === "No quiz attempts remain")
      return label(
        fr,
        "All assessment attempts have been used. Ask your manager to authorize a new attempt.",
        "Toutes les tentatives d’évaluation ont été utilisées. Demandez à votre responsable d’autoriser une nouvelle tentative.",
      );
    return message;
  }
  return label(
    fr,
    "Unable to complete that action.",
    "Impossible d’effectuer cette action.",
  );
};

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
  const [blockIndex, setBlockIndex] = useState(0);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const heartbeatRef = useRef<Record<string, number>>({});
  const sidebarBeforeFocusRef = useRef<boolean | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const readerRef = useRef<HTMLElement | null>(null);
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useUiStore((state) => state.setSidebarCollapsed);
  useEffect(() => {
    return () => {
      const previous = sidebarBeforeFocusRef.current;
      if (previous === null) return;
      setSidebarCollapsed(previous);
      sidebarBeforeFocusRef.current = null;
    };
  }, [setSidebarCollapsed]);
  useEffect(() => {
    if (!focusMode) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setFocusMode(false);
      const previous = sidebarBeforeFocusRef.current;
      if (previous !== null) {
        setSidebarCollapsed(previous);
        sidebarBeforeFocusRef.current = null;
      }
    };
    const handleFullscreenExit = () => {
      if (document.fullscreenElement) return;
      setFocusMode(false);
      const previous = sidebarBeforeFocusRef.current;
      if (previous !== null) {
        setSidebarCollapsed(previous);
        sidebarBeforeFocusRef.current = null;
      }
    };
    document.addEventListener("keydown", handleEscape);
    document.addEventListener("fullscreenchange", handleFullscreenExit);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("fullscreenchange", handleFullscreenExit);
    };
  }, [focusMode, setSidebarCollapsed]);
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
  const quiz = useMutation<
    QuizSubmissionResult,
    unknown,
    { blockId: string; values: unknown[] }
  >({
    mutationFn: ({ blockId, values }: { blockId: string; values: unknown[] }) =>
      post<QuizSubmissionResult>(
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
  const selectedBlocks = selected?.lesson.blocks ?? [];
  const firstIncompleteBlockIndex = selectedBlocks.findIndex((block) =>
    block.type === "acknowledgment"
      ? !block.progress.acknowledgedAt
      : !block.progress.completedAt,
  );
  const nextBlockIndex =
    firstIncompleteBlockIndex >= 0
      ? firstIncompleteBlockIndex
      : Math.max(0, selectedBlocks.length - 1);
  useEffect(() => {
    if (!selected?.lesson.id) return;
    setBlockIndex(nextBlockIndex);
  }, [selected?.lesson.id, nextBlockIndex]);
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
  const activeBlock =
    lesson.blocks[
      Math.min(blockIndex, Math.max(0, lesson.blocks.length - 1))
    ];
  const requiredCount = outline.filter(
    ({ lesson: row }) => row.required,
  ).length;
  const completedCount = outline.filter(
    ({ lesson: row }) => row.required && row.progress.status === "completed",
  ).length;
  const restoreReadingSpace = () => {
    setFocusMode(false);
    const previous = sidebarBeforeFocusRef.current;
    if (previous !== null) {
      setSidebarCollapsed(previous);
      sidebarBeforeFocusRef.current = null;
    }
    if (typeof document !== "undefined" && document.fullscreenElement)
      void document.exitFullscreen().catch(() => undefined);
  };
  const toggleReadingSpace = () => {
    if (focusMode) {
      restoreReadingSpace();
      return;
    }
    sidebarBeforeFocusRef.current = sidebarCollapsed;
    setSidebarCollapsed(true);
    setFocusMode(true);
    // Real full screen when the browser allows it; the fixed reading layer
    // below already fills the window when it does not.
    const target = readerRef.current;
    if (target?.requestFullscreen && !document.fullscreenElement)
      void target.requestFullscreen().catch(() => undefined);
  };
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
    <main
      ref={readerRef}
      className={
        focusMode
          ? "fixed inset-0 z-[70] flex flex-col gap-2 overflow-y-auto bg-page p-2"
          : "mx-auto max-w-7xl space-y-4 p-4 sm:p-5 lg:p-7"
      }
    >
      {focusMode ? null : (
      <Link
        href={`/${orgSlug}/my-trainings`}
        className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline"
      >
        <ArrowLeft className="size-4" />
        {label(fr, "My training", "Mes formations")}
      </Link>
      )}
      <header className={`relative overflow-hidden rounded-2xl border border-brand/20 bg-[radial-gradient(circle_at_87%_12%,rgba(129,140,248,.25),transparent_28%),linear-gradient(135deg,#102b55,#24488f_58%,#6643ae)] p-3.5 text-white shadow-[0_18px_40px_-30px_rgba(13,36,85,.95)] ${focusMode ? "shrink-0 py-2 sm:px-4 sm:py-2" : "sm:p-4"}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">
              {course.assignment.course.name}
            </h1>
            {focusMode ? (
              <p className="mt-0.5 text-[11px] text-indigo-50/90">
                {label(fr, "Progress", "Progression")} ·{" "}
                <b className="text-white">{course.assignment.progressPercent}%</b>
                {"  ·  "}
                {label(fr, "Lessons", "Leçons")} ·{" "}
                <b className="text-white">
                  {completedCount}/{requiredCount}
                </b>
              </p>
            ) : (
            <p className="mt-1 max-w-3xl truncate text-xs text-indigo-50/90 sm:text-sm">
              {course.assignment.course.summary ??
                label(
                  fr,
                  "Complete each required lesson and assessment to validate this course.",
                  "Terminez chaque leçon et évaluation requise pour valider ce parcours.",
                )}
            </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={statusVariant(course.assignment.status)}>
              {statusText(course.assignment.status, fr)}
            </Badge>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void toggleReadingSpace()}
              className="h-8 border border-white/20 bg-white/10 px-2.5 text-xs text-white hover:bg-white/20 hover:text-white"
            >
              {focusMode ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              {focusMode
                ? label(fr, "Reduce", "Réduire")
                : label(fr, "Large screen", "Grand écran")}
            </Button>
          </div>
        </div>
        {focusMode ? null : (
        <>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-md bg-white/10 px-2 py-1 text-indigo-50">
            {label(fr, "Progress", "Progression")} · <b className="text-white">{course.assignment.progressPercent}%</b>
          </span>
          <span className="rounded-md bg-white/10 px-2 py-1 text-indigo-50">
            {label(fr, "Lessons", "Leçons")} · <b className="text-white">{completedCount}/{requiredCount}</b>
          </span>
          <span className="rounded-md bg-white/10 px-2 py-1 text-indigo-50">
            {label(fr, "Deadline", "Échéance")} · <b className="text-white">{date(course.assignment.dueOn, fr)}</b>
          </span>
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full rounded-full bg-emerald-300 transition-[width]"
            style={{ width: `${course.assignment.progressPercent}%` }}
          />
        </div>
        </>
        )}
      </header>
      <section className="space-y-3">
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
        <div className={outlineOpen ? "grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)] xl:gap-5" : undefined}>
          {outlineOpen ? (
            <aside className="hidden rounded-2xl border border-border bg-surface-1 p-3 shadow-sm xl:block">
              <div className="flex items-center justify-between gap-2 px-2 py-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  {label(fr, "Course outline", "Plan du cours")}
                </p>
                <button
                  type="button"
                  onClick={() => setOutlineOpen(false)}
                  className="text-xs font-semibold text-brand hover:underline"
                >
                  {label(fr, "Hide", "Masquer")}
                </button>
              </div>
              <div className="mt-2 max-h-[68vh] overflow-y-auto border-t border-border pt-3">
                {outlineList(true)}
              </div>
            </aside>
          ) : null}
        <article className={`rounded-2xl border border-border bg-surface-1 shadow-sm ${focusMode ? "p-2 sm:p-3" : "p-5 sm:p-7"}`}>
          <div className={`flex flex-wrap justify-between ${focusMode ? "items-center gap-2" : "items-start gap-3"}`}>
            <div>
              {focusMode ? null : (
              <p className="text-xs font-semibold uppercase tracking-[.14em] text-brand">
                {module.title}
              </p>
              )}
              <h2 className={focusMode ? "text-base font-semibold text-ink" : "mt-1 text-2xl font-semibold tracking-tight text-ink"}>
                {lesson.title}
              </h2>
              {lesson.summary && !focusMode ? (
                <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">
                  {lesson.summary}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setOutlineOpen((value) => !value)}
              >
                <BookOpenCheck className="size-4" />
                {label(fr, "Course plan", "Plan du cours")}
              </Button>
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
          {lesson.estimatedDurationMinutes && !focusMode ? (
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-ink-muted">
              <Clock3 className="size-3.5" />
              {lesson.estimatedDurationMinutes} {label(fr, "min", "min")}
            </p>
          ) : null}
          {activeBlock ? (
            <div className={focusMode ? "mt-2" : "mt-6"}>
              <div className={`mb-3 items-center justify-between gap-3 rounded-xl border border-brand/15 bg-brand/[.04] px-3 py-2 text-xs text-ink-secondary ${focusMode ? "hidden" : "flex"}`}>
                <span className="font-semibold text-brand">
                  {label(
                    fr,
                    `Lesson step ${blockIndex + 1} of ${lesson.blocks.length}`,
                    `Étape de la leçon ${blockIndex + 1} sur ${lesson.blocks.length}`,
                  )}
                </span>
                <span>
                  {activeBlock.progress.completedAt ||
                  (activeBlock.type === "quiz" &&
                    ["completed", "awaiting_review"].includes(
                      course.assignment.status,
                    ))
                    ? label(fr, "This step is complete.", "Cette étape est terminée.")
                    : label(
                        fr,
                        "Complete this step to continue.",
                        "Terminez cette étape pour continuer.",
                      )}
                </span>
              </div>
              <ProfessionalBlockReader
                key={activeBlock.id}
                block={activeBlock}
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
                  progress.mutate({ blockId: activeBlock.id, body })
                }
                progressLoading={progress.isPending}
                onQuiz={(values) =>
                  quiz.mutate({ blockId: activeBlock.id, values })
                }
                quizLoading={quiz.isPending}
                quizResult={quiz.data}
                courseQuizPassed={[
                  "completed",
                  "awaiting_review",
                ].includes(course.assignment.status)}
                answers={answers}
                setAnswers={setAnswers}
                heartbeatRef={heartbeatRef}
                focusMode={focusMode}
              />
            </div>
          ) : (
            <EmptyState
              title={label(fr, "No content in this lesson", "Aucun contenu dans cette leçon")}
              description={label(
                fr,
                "Your manager is still preparing this lesson.",
                "Votre responsable prépare encore cette leçon.",
              )}
            />
          )}
          {progress.isError || quiz.isError ? (
            <p className="mt-4 text-sm text-critical">
              {errorText(progress.error ?? quiz.error, fr)}
            </p>
          ) : null}
          <div className={`flex items-center justify-between gap-3 border-t border-border ${focusMode ? "mt-2 pt-2" : "mt-7 pt-5"}`}>
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
          <div className="mt-4">
            <LessonNotesPanel
              key={lesson.id}
              orgSlug={orgSlug}
              assignmentId={assignmentId}
              lessonId={lesson.id}
              fr={fr}
            />
          </div>
        </article>
        </div>
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

function QuizPassCelebration({
  fr,
  reduceMotion,
}: {
  fr: boolean;
  reduceMotion: boolean;
}) {
  const transition = reduceMotion ? { duration: 0.15 } : { duration: 0.32 };
  return (
    <motion.section
      key="quiz-pass-celebration"
      role="status"
      aria-live="polite"
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, y: -6 }}
      transition={transition}
      className="relative mt-4 overflow-hidden rounded-xl border border-positive/30 bg-positive/10 px-5 py-6 text-center"
    >
      <motion.span
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 size-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-positive/30"
        initial={{ opacity: 0.6, scale: 0.55 }}
        animate={
          reduceMotion
            ? { opacity: 0.25, scale: 1 }
            : { opacity: [0.55, 0], scale: [0.55, 1.5] }
        }
        transition={{ duration: reduceMotion ? 0.2 : 1.1, ease: "easeOut" }}
      />
      <motion.div
        className="relative mx-auto flex size-14 items-center justify-center rounded-full bg-positive text-white shadow-lg shadow-positive/25"
        initial={reduceMotion ? undefined : { scale: 0.65, rotate: -10 }}
        animate={
          reduceMotion
            ? undefined
            : { scale: [0.65, 1.12, 1], rotate: [-10, 4, 0] }
        }
        transition={{ duration: reduceMotion ? 0 : 0.52, ease: "easeOut" }}
      >
        <Award className="size-7" />
      </motion.div>
      <h4 className="relative mt-3 text-base font-semibold text-positive">
        {label(
          fr,
          "Congratulations — assessment passed!",
          "Félicitations — évaluation réussie !",
        )}
      </h4>
      <p className="relative mt-1 text-sm text-ink-secondary">
        {label(
          fr,
          "Your course is now waiting for supervisor validation.",
          "Votre formation attend maintenant la validation du responsable.",
        )}
      </p>
    </motion.section>
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
  quizResult,
  courseQuizPassed,
  answers,
  setAnswers,
  heartbeatRef,
  focusMode,
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
  quizResult?: QuizSubmissionResult;
  courseQuizPassed: boolean;
  answers: Record<string, unknown>;
  setAnswers: (value: Record<string, unknown>) => void;
  heartbeatRef: React.MutableRefObject<Record<string, number>>;
  focusMode: boolean;
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
  const quizHasUnansweredRequiredQuestion = questions.some(
    (question, index) => {
      const answer = answers[`${block.id}:${String(question.id ?? index)}`];
      return question.type === "multiple_choice"
        ? !Array.isArray(answer) || answer.length === 0
        : answer === undefined || answer === null || answer === "";
    },
  );
  const secureUrl = block.documentId
    ? orgApiUrl(
        orgSlug,
        `my-trainings/${assignmentId}/blocks/${block.id}/content`,
      )
    : null;
  const complete =
    Boolean(block.progress.completedAt) ||
    (block.type === "quiz" && courseQuizPassed);
  const reduceMotion = useReducedMotion();
  const [showQuizCelebration, setShowQuizCelebration] = useState(false);
  useEffect(() => {
    // Celebrate only after a successful submission in this session. A refresh of
    // an already completed lesson stays quiet and shows the compact completion state.
    if (!complete || !quizResult?.passed) return;
    setShowQuizCelebration(true);
    const timeout = window.setTimeout(
      () => setShowQuizCelebration(false),
      reduceMotion ? 900 : 2800,
    );
    return () => window.clearTimeout(timeout);
  }, [complete, quizResult?.passed, reduceMotion]);
  const action = (next: Record<string, unknown>) => onProgress(next);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const maxWatchedRef = useRef(
    Math.max(0, Number(block.progress.videoPositionSeconds ?? 0)),
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(
    Math.max(0, Number(block.progress.videoPositionSeconds ?? 0)),
  );
  const [furthest, setFurthest] = useState(
    Math.max(0, Number(block.progress.videoPositionSeconds ?? 0)),
  );
  const [captionsOn, setCaptionsOn] = useState(true);
  // Captions are stored as WebVTT text on the block; the player needs a URL.
  const captionsUrl = useMemo(() => {
    const vtt = (block.captions ?? "").trim();
    if (!vtt) return null;
    const textTrack = vtt.startsWith("WEBVTT") ? vtt : `WEBVTT\n\n${vtt}`;
    // A data URL needs no clean-up (a blob URL can be revoked too early).
    return `data:text/vtt;charset=utf-8,${encodeURIComponent(textTrack)}`;
  }, [block.captions]);
  useEffect(() => {
    const track = videoRef.current?.textTracks?.[0];
    if (track) track.mode = captionsOn ? "showing" : "hidden";
  }, [captionsOn, captionsUrl]);
  /** Progress is earned at normal speed only: any other rate is reset. */
  const keepNormalSpeed = (video: HTMLVideoElement) => {
    if (video.playbackRate !== 1) video.playbackRate = 1;
    if (video.defaultPlaybackRate !== 1) video.defaultPlaybackRate = 1;
  };
  const heartbeat = (position: number) =>
    action({
      action: "heartbeat",
      videoPositionSeconds: position,
      ...(duration > 0 ? { durationSeconds: Math.ceil(duration) } : {}),
    });
  const seekTo = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(seconds, maxWatchedRef.current));
  };
  const watchedSeconds = Math.max(0, Number(block.progress.watchedSeconds ?? 0));
  const requiredPercent = Math.max(
    1,
    Math.min(100, Number(block.minimumWatchedPercent || 90)),
  );
  const watchedPercent =
    duration > 0
      ? Math.min(100, Math.round((watchedSeconds / duration) * 100))
      : 0;
  const videoFrameRef = useRef<HTMLDivElement | null>(null);
  const [videoFullscreen, setVideoFullscreen] = useState(false);
  useEffect(() => {
    const sync = () =>
      setVideoFullscreen(
        Boolean(videoFrameRef.current) &&
          document.fullscreenElement === videoFrameRef.current,
      );
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const toggleVideoFullscreen = () => {
    const frame = videoFrameRef.current;
    if (!frame) return;
    if (document.fullscreenElement === frame) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (frame.requestFullscreen)
      void frame.requestFullscreen().catch(() => undefined);
  };
  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      await video.play().catch(() => undefined);
      return;
    }
    video.pause();
  };
  const rewindVideo = () => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, video.currentTime - 10);
  };
  const toggleMuted = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  };
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface-1">
      <div className={`flex-wrap items-start justify-between gap-3 border-b border-border bg-surface-2/60 px-3 py-2 ${focusMode && block.type === "video" ? "hidden" : "flex"}`}>
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
      <div className={focusMode && block.type === "video" ? "p-0" : "p-4"}>
        {body && block.type === "heading" ? (
          <h3
            className={
              focusMode
                ? "mx-auto max-w-4xl text-2xl font-semibold tracking-tight text-ink sm:text-3xl"
                : "text-xl font-semibold tracking-tight text-ink sm:text-2xl"
            }
          >
            {body}
          </h3>
        ) : body ? (
          <RichText text={body} large={focusMode} />
        ) : null}
        {block.type === "callout" ? (
          <div className="mt-3 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-ink">
            {String(content.message ?? body)}
          </div>
        ) : null}
        {secureUrl && block.type === "video" ? (
          <div
            ref={videoFrameRef}
            onDoubleClick={toggleVideoFullscreen}
            className={
              videoFullscreen
                ? "relative flex h-screen w-screen items-center justify-center bg-black"
                : focusMode
                  ? `relative flex items-center justify-center overflow-hidden rounded-xl bg-black ${body ? "mt-3" : ""}`
                  : "relative mt-3 overflow-hidden rounded-xl bg-black"
            }
          >
            <video
              ref={videoRef}
              className={
                videoFullscreen
                  ? "h-screen max-h-screen w-full object-contain"
                  : focusMode
                    ? "w-full object-contain"
                    : "aspect-video w-full"
              }
              style={
                focusMode && !videoFullscreen
                  ? { height: "calc(100dvh - 17rem)" }
                  : undefined
              }
              src={secureUrl}
              controlsList="nodownload noplaybackrate"
              disablePictureInPicture
              onContextMenu={(event) => event.preventDefault()}
              onLoadedMetadata={(event) => {
                const video = event.currentTarget;
                keepNormalSpeed(video);
                if (Number.isFinite(video.duration)) setDuration(video.duration);
                const savedPosition = Math.max(
                  0,
                  Number(block.progress.videoPositionSeconds ?? 0),
                );
                maxWatchedRef.current = savedPosition;
                setFurthest(savedPosition);
                if (savedPosition > 0 && savedPosition < video.duration) {
                  video.currentTime = savedPosition;
                }
              }}
              onRateChange={(event) => keepNormalSpeed(event.currentTarget)}
              onPlay={(event) => {
                keepNormalSpeed(event.currentTarget);
                setIsPlaying(true);
              }}
              onSeeking={(event) => {
                const video = event.currentTarget;
                const maximum = maxWatchedRef.current;
                if (video.currentTime > maximum + 0.5) {
                  video.currentTime = maximum;
                }
              }}
              onTimeUpdate={(event) => {
                const exact = event.currentTarget.currentTime;
                const current = Math.floor(exact);
                setCurrentTime(exact);
                maxWatchedRef.current = Math.max(maxWatchedRef.current, current);
                setFurthest(maxWatchedRef.current);
                const last = heartbeatRef.current[block.id] ?? 0;
                if (current - last >= 12) {
                  heartbeatRef.current[block.id] = current;
                  heartbeat(current);
                }
              }}
              onEnded={(event) =>
                heartbeat(Math.floor(event.currentTarget.currentTime))
              }
              onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
              onPause={(event) => {
                setIsPlaying(false);
                heartbeat(Math.floor(event.currentTarget.currentTime));
              }}
            >
              {captionsUrl ? (
                <track
                  kind="subtitles"
                  src={captionsUrl}
                  srcLang={fr ? "fr" : "en"}
                  label={label(fr, "Subtitles", "Sous-titres")}
                  default
                />
              ) : null}
            </video>
            <div className="absolute inset-x-3 bottom-[60px] z-10 rounded-lg bg-black/55 px-3 pt-2 pb-1 backdrop-blur-sm sm:inset-x-6">
              <div
                className="relative h-2 cursor-pointer rounded-full bg-white/25"
                role="slider"
                tabIndex={0}
                aria-label={label(fr, "Video position", "Position dans la vidéo")}
                aria-valuemin={0}
                aria-valuemax={Math.round(duration)}
                aria-valuenow={Math.round(currentTime)}
                onClick={(event) => {
                  if (!duration) return;
                  const box = event.currentTarget.getBoundingClientRect();
                  seekTo(((event.clientX - box.left) / box.width) * duration);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") seekTo(currentTime - 5);
                  if (event.key === "ArrowRight") seekTo(currentTime + 5);
                }}
                title={label(
                  fr,
                  "You can go back, but not beyond what you have already watched.",
                  "Vous pouvez revenir en arrière, mais pas au-delà de ce que vous avez déjà regardé.",
                )}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-white/45"
                  style={{
                    width: `${duration ? Math.min(100, (furthest / duration) * 100) : 0}%`,
                  }}
                />
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-brand"
                  style={{
                    width: `${duration ? Math.min(100, (currentTime / duration) * 100) : 0}%`,
                  }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[11px] font-medium text-white">
                <span>{clock(currentTime)}</span>
                <span>
                  {duration
                    ? `${clock(duration)} · ${label(fr, "remaining", "reste")} ${clock(Math.max(0, duration - currentTime))}`
                    : "—"}
                </span>
              </div>
            </div>
            <div className="absolute bottom-[22px] left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5">
              <button
                type="button"
                onClick={() => void togglePlayback()}
                aria-label={isPlaying ? label(fr, "Pause", "Pause") : label(fr, "Play", "Lire")}
                className="grid size-8 place-items-center rounded-full border border-white/30 bg-black/70 text-white shadow-md backdrop-blur-sm transition hover:bg-black/90"
              >
                {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
              </button>
              <button
                type="button"
                onClick={rewindVideo}
                aria-label={label(fr, "Replay the last 10 seconds", "Revoir les 10 dernières secondes")}
                title={label(fr, "Replay 10 seconds", "Revoir 10 secondes")}
                className="grid size-8 place-items-center rounded-full border border-white/30 bg-black/70 text-white shadow-md backdrop-blur-sm transition hover:bg-black/90"
              >
                <RotateCcw className="size-4" />
              </button>
              <button
                type="button"
                onClick={toggleMuted}
                aria-label={muted ? label(fr, "Enable sound", "Activer le son") : label(fr, "Mute", "Couper le son")}
                className="grid size-8 place-items-center rounded-full border border-white/30 bg-black/70 text-white shadow-md backdrop-blur-sm transition hover:bg-black/90"
              >
                {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              </button>
              <button
                type="button"
                onClick={toggleVideoFullscreen}
                aria-label={
                  videoFullscreen
                    ? label(fr, "Exit full screen", "Quitter le plein écran")
                    : label(fr, "Full screen video", "Vidéo en plein écran")
                }
                title={
                  videoFullscreen
                    ? label(fr, "Exit full screen", "Quitter le plein écran")
                    : label(fr, "Full screen video", "Vidéo en plein écran")
                }
                className="grid size-8 place-items-center rounded-full border border-white/30 bg-black/70 text-white shadow-md backdrop-blur-sm transition hover:bg-black/90"
              >
                {videoFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </button>
              {captionsUrl ? (
                <button
                  type="button"
                  onClick={() => setCaptionsOn((value) => !value)}
                  aria-pressed={captionsOn}
                  aria-label={label(fr, "Subtitles", "Sous-titres")}
                  title={label(fr, "Subtitles", "Sous-titres")}
                  className={`grid h-8 place-items-center rounded-full border px-2 text-[11px] font-bold shadow-md backdrop-blur-sm transition ${captionsOn ? "border-white bg-white text-black" : "border-white/30 bg-black/70 text-white hover:bg-black/90"}`}
                >
                  CC
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {secureUrl && block.type === "video" && !complete ? (
          <div className={`mt-2 rounded-xl border border-brand/20 bg-brand/[.04] px-3 py-2 ${focusMode ? "mx-2 mb-2" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-medium text-ink">
                {label(
                  fr,
                  `Watch at least ${requiredPercent}% of the video at normal speed.`,
                  `Regardez au moins ${requiredPercent} % de la vidéo à vitesse normale.`,
                )}
              </span>
              <span className="font-semibold text-brand">
                {duration
                  ? label(
                      fr,
                      `Watched: ${watchedPercent}% / ${requiredPercent}%`,
                      `Regardé : ${watchedPercent} % / ${requiredPercent} %`,
                    )
                  : label(fr, "Loading…", "Chargement…")}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full bg-good transition-[width]"
                style={{
                  width: `${Math.min(100, (watchedPercent / requiredPercent) * 100)}%`,
                }}
              />
            </div>
          </div>
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
        {secureUrl && block.type === "image" ? (
          <ZoomableImage
            src={secureUrl}
            alt={block.title ?? label(fr, "Training image", "Image de formation")}
            fr={fr}
            onOpen={() => action({ action: "open" })}
          />
        ) : null}
        {secureUrl && ["document", "file"].includes(block.type) ? (
          <iframe
            title={block.title ?? "Training document"}
            src={secureUrl}
            className={`mt-3 w-full rounded-xl border border-border bg-white ${focusMode ? "" : "h-[32rem]"}`}
            style={focusMode ? { height: "calc(100dvh - 12rem)" } : undefined}
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
        {items.length && block.type === "checklist" && !complete ? (
          <p className="mt-4 text-xs font-medium text-ink-secondary">
            {label(fr, "Checked", "Cochés")} :{" "}
            <b className="text-ink">
              {Array.isArray(block.progress.checklistState)
                ? block.progress.checklistState.length
                : 0}{" "}
              / {items.length}
            </b>{" "}
            ·{" "}
            {label(
              fr,
              "check every required item to complete this step.",
              "cochez chaque élément requis pour terminer cette étape.",
            )}
          </p>
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
          <AnimatePresence mode="wait" initial={false}>
            {showQuizCelebration ? (
              <QuizPassCelebration fr={fr} reduceMotion={Boolean(reduceMotion)} />
            ) : (
              <motion.div
                key="quiz-reader"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduceMotion ? 0.1 : 0.2 }}
                className="mt-4 space-y-5 rounded-xl border border-border p-4"
              >
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
            {complete ? (
              <div className="flex items-center gap-2 rounded-lg border border-positive/25 bg-positive/10 px-3 py-2 text-sm font-medium text-positive">
                <CheckCircle2 className="size-4" />
                {label(
                  fr,
                  "Assessment passed. Your completion is waiting for supervisor validation.",
                  "Évaluation réussie. Votre formation attend la validation du responsable.",
                )}
              </div>
            ) : questions.map((question, index) => {
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
            {!complete ? (
              <Button
                disabled={disabled || quizHasUnansweredRequiredQuestion}
                loading={quizLoading}
                onClick={() =>
                  onQuiz(
                    questions.map(
                      (question, index) =>
                        answers[
                          `${block.id}:${String(question.id ?? index)}`
                        ] ?? null,
                    ),
                  )
                }
              >
                <ShieldCheck className="size-4" />
                {label(fr, "Submit assessment", "Envoyer l’évaluation")}
              </Button>
            ) : null}
            {quizHasUnansweredRequiredQuestion && !complete ? (
              <p className="text-xs text-ink-secondary">
                {label(
                  fr,
                  "Answer every question before submitting the assessment.",
                  "Répondez à chaque question avant d’envoyer l’évaluation.",
                )}
              </p>
            ) : null}
            {quizResult && !quizResult.awaitingGrading && !complete ? (
              <p
                className={cn(
                  "text-xs font-medium",
                  quizResult.passed ? "text-positive" : "text-warning",
                )}
              >
                {quizResult.passed
                  ? label(
                      fr,
                      `Assessment passed — score ${Number(quizResult.score ?? 0)}%.`,
                      `Évaluation réussie — score ${Number(quizResult.score ?? 0)} %.`,
                    )
                  : label(
                      fr,
                      `Score ${Number(quizResult.score ?? 0)}% — ${Number(quizResult.passingScore ?? 70)}% is required. Review the lesson, then try again if an attempt remains.`,
                      `Score ${Number(quizResult.score ?? 0)} % — ${Number(quizResult.passingScore ?? 70)} % est requis. Relisez la leçon, puis réessayez s’il reste une tentative.`,
                    )}
              </p>
            ) : null}
              </motion.div>
            )}
          </AnimatePresence>
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

/** 75 → "1:15", 3725 → "1:02:05". */
function clock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${minutes}:${rest}`;
}

/** **bold** and *italic* inside one line, rendered as React text (never HTML). */
function inlineMarks(text: string, keyPrefix: string) {
  const parts: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    const token = match[0];
    parts.push(
      token.startsWith("**") ? (
        <strong key={`${keyPrefix}-${index}`} className="font-semibold text-ink">
          {token.slice(2, -2)}
        </strong>
      ) : (
        <em key={`${keyPrefix}-${index}`}>{token.slice(1, -1)}</em>
      ),
    );
    last = start + token.length;
    index += 1;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/**
 * Lesson text with light formatting written by the trainer:
 * "# " / "## " titles, "- " bullets, "1. " numbered steps, **bold**, *italic*,
 * blank line = new paragraph. Plain text keeps working unchanged.
 */
function RichText({ text, large }: { text: string; large: boolean }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const bodyClass = large
    ? "text-base leading-8 text-ink sm:text-lg sm:leading-9"
    : "text-sm leading-7 text-ink-secondary";
  const flushParagraph = () => {
    if (!paragraph.length) return;
    const key = `p-${blocks.length}`;
    blocks.push(
      <p key={key} className={`${bodyClass} whitespace-pre-wrap`}>
        {inlineMarks(paragraph.join("\n"), key)}
      </p>,
    );
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const key = `l-${blocks.length}`;
    const ListTag = list.ordered ? "ol" : "ul";
    blocks.push(
      <ListTag
        key={key}
        className={`${bodyClass} space-y-1 pl-6 ${list.ordered ? "list-decimal" : "list-disc"}`}
      >
        {list.items.map((item, index) => (
          <li key={`${key}-${index}`}>{inlineMarks(item, `${key}-${index}`)}</li>
        ))}
      </ListTag>,
    );
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1]!.length;
      const key = `h-${blocks.length}`;
      blocks.push(
        <p
          key={key}
          role="heading"
          aria-level={level + 2}
          className={`font-semibold tracking-tight text-ink ${
            level === 1
              ? large ? "text-2xl" : "text-xl"
              : level === 2
                ? large ? "text-xl" : "text-lg"
                : large ? "text-lg" : "text-base"
          }`}
        >
          {inlineMarks(heading[2]!, key)}
        </p>,
      );
    } else if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
    } else if (!line.trim()) {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return (
    <div className={`space-y-3 ${large ? "mx-auto max-w-4xl" : ""}`}>{blocks}</div>
  );
}

/** A lesson image: shown in full, a click opens it large (Échap / click closes). */
function ZoomableImage({
  src,
  alt,
  fr,
  onOpen,
}: {
  src: string;
  alt: string;
  fr: boolean;
  onOpen: () => void;
}) {
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => {
    if (!zoomed) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoomed(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [zoomed]);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setZoomed(true);
          onOpen();
        }}
        className="group relative mt-3 block w-full overflow-hidden rounded-xl border border-border bg-surface-2"
        aria-label={label(fr, "Enlarge the image", "Agrandir l’image")}
      >
        {/* Private training file served by the API. */}
        <img src={src} alt={alt} className="mx-auto max-h-[32rem] w-auto object-contain" />
        <span className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-semibold text-white opacity-80 group-hover:opacity-100">
          <Maximize2 className="size-3" />
          {label(fr, "Enlarge", "Agrandir")}
        </span>
      </button>
      {zoomed ? (
        <div
          className="fixed inset-0 z-[90] grid place-items-center bg-black/85 p-3"
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={() => setZoomed(false)}
        >
          <img src={src} alt={alt} className="max-h-[94dvh] max-w-[96vw] rounded-lg object-contain" />
          <button
            type="button"
            className="absolute top-3 right-3 rounded-full bg-white/90 px-3 py-1.5 text-sm font-semibold text-black"
            onClick={() => setZoomed(false)}
          >
            {label(fr, "Close", "Fermer")}
          </button>
        </div>
      ) : null}
    </>
  );
}

type LessonQuestion = {
  id: string;
  question: string;
  answer: string | null;
  answeredByName: string | null;
  answeredAt: string | null;
  createdAt: string;
};

/** Private notes for one lesson and questions to the trainer. */
function LessonNotesPanel({
  orgSlug,
  assignmentId,
  lessonId,
  fr,
}: {
  orgSlug: string;
  assignmentId: string;
  lessonId: string;
  fr: boolean;
}) {
  const client = useQueryClient();
  const key = ["my-training-notes", orgSlug, assignmentId, lessonId];
  const data = useQuery({
    queryKey: key,
    queryFn: () =>
      get<{ note: string; noteUpdatedAt: string | null; questions: LessonQuestion[] }>(
        orgUrl(orgSlug, `my-trainings/${assignmentId}/lessons/${lessonId}/notes`),
      ),
  });
  const [note, setNote] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const saveNote = useMutation({
    mutationFn: (value: string) =>
      put(orgUrl(orgSlug, `my-trainings/${assignmentId}/lessons/${lessonId}/note`), {
        note: value,
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: key }),
  });
  const ask = useMutation({
    mutationFn: (value: string) =>
      post(orgUrl(orgSlug, `my-trainings/${assignmentId}/lessons/${lessonId}/questions`), {
        question: value,
      }),
    onSuccess: () => {
      setQuestion("");
      void client.invalidateQueries({ queryKey: key });
    },
  });
  const noteValue = note ?? data.data?.note ?? "";
  const questions = data.data?.questions ?? [];
  const waiting = questions.filter((item) => !item.answer).length;
  return (
    <section className="grid gap-4 rounded-2xl border border-border bg-surface-1 p-4 shadow-sm lg:grid-cols-2">
      <div>
        <h3 className="text-sm font-semibold text-ink">
          {label(fr, "My notes", "Mes notes")}
        </h3>
        <p className="mt-0.5 text-xs text-ink-secondary">
          {label(
            fr,
            "Only you can read them. Saved for this lesson.",
            "Vous seul pouvez les lire. Elles restent attachées à cette leçon.",
          )}
        </p>
        <Textarea
          className="mt-2 min-h-32"
          value={noteValue}
          onChange={(event) => setNote(event.target.value)}
          placeholder={label(fr, "Write what you want to remember…", "Notez ce que vous voulez retenir…")}
        />
        <div className="mt-2 flex items-center gap-3">
          <Button
            size="sm"
            variant="secondary"
            loading={saveNote.isPending}
            disabled={note === null || note === (data.data?.note ?? "")}
            onClick={() => saveNote.mutate(noteValue, { onSuccess: () => setNote(null) })}
          >
            {label(fr, "Save note", "Enregistrer la note")}
          </Button>
          {saveNote.isSuccess && note === null ? (
            <span className="text-xs text-good">{label(fr, "Saved", "Enregistrée")}</span>
          ) : null}
          {saveNote.isError ? (
            <span className="text-xs text-critical">{errorText(saveNote.error, fr)}</span>
          ) : null}
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-ink">
          {label(fr, "Ask the trainer", "Poser une question au formateur")}
          {waiting ? (
            <Badge className="ml-2" variant="warning">
              {waiting} {label(fr, "waiting", "en attente")}
            </Badge>
          ) : null}
        </h3>
        <p className="mt-0.5 text-xs text-ink-secondary">
          {label(
            fr,
            "The trainer is notified and the answer appears here.",
            "Le formateur est prévenu et la réponse s’affiche ici.",
          )}
        </p>
        <Textarea
          className="mt-2 min-h-20"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={label(fr, "Your question about this lesson…", "Votre question sur cette leçon…")}
        />
        <Button
          className="mt-2"
          size="sm"
          loading={ask.isPending}
          disabled={!question.trim()}
          onClick={() => ask.mutate(question.trim())}
        >
          {label(fr, "Send the question", "Envoyer la question")}
        </Button>
        {ask.isError ? (
          <p className="mt-1 text-xs text-critical">{errorText(ask.error, fr)}</p>
        ) : null}
        {questions.length ? (
          <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
            {questions.map((item) => (
              <li key={item.id} className="rounded-xl border border-border bg-surface-2 p-3 text-sm">
                <p className="font-medium text-ink">{item.question}</p>
                <p className="mt-0.5 text-[11px] text-ink-muted">
                  {new Date(item.createdAt).toLocaleString(fr ? "fr-FR" : "en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
                {item.answer ? (
                  <div className="mt-2 rounded-lg border border-good/25 bg-good/10 p-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-good-ink">
                      {label(fr, "Answer", "Réponse")}
                      {item.answeredByName ? ` · ${item.answeredByName}` : ""}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-ink">{item.answer}</p>
                  </div>
                ) : (
                  <p className="mt-2 text-xs font-medium text-warning-ink">
                    {label(fr, "Waiting for the trainer’s answer", "En attente de la réponse du formateur")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
