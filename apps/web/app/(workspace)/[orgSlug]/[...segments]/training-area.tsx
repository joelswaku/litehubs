"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Award,
  BookOpenCheck,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  ExternalLink,
  FileText,
  GraduationCap,
  LibraryBig,
  Link as LinkIcon,
  PlayCircle,
  Plus,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field as BaseField, Input, Textarea } from "@/components/ui/input";
import {
  EmptyState,
  ErrorState,
  NoAccessState,
  SkeletonCard,
} from "@/components/ui/states";
import { api, ApiError, del, get, orgApiUrl, orgUrl, patch, post } from "@/lib/api";
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
type Course = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  category: string;
  validityMonths: number | null;
  isMandatory: boolean;
  isActive: boolean;
  assignmentCount: number;
  completedCount: number;
};
type Material = {
  id: string;
  courseId: string;
  title: string;
  description?: string | null;
  materialType: "document" | "video" | "link" | "assessment" | "other";
  externalUrl?: string | null;
  documentId?: string | null;
  estimatedDurationMinutes?: number | null;
  requiresAcknowledgment?: boolean;
  quizQuestions?: Array<{
    id?: string;
    question: string;
    options: string[];
    correctOption: number;
  }> | null;
  quizPassingScore?: number | null;
  isRequired: boolean;
  isActive: boolean;
};
type Assignment = {
  id: string;
  course: {
    id: string;
    code: string;
    name: string;
    category: string;
    isMandatory: boolean;
    validityMonths: number | null;
  };
  employee: Employee;
  province?: { id: string; name: string } | null;
  site?: { id: string; name: string } | null;
  assignedOn: string;
  dueOn?: string | null;
  status:
    | "assigned"
    | "in_progress"
    | "awaiting_review"
    | "completed"
    | "overdue"
    | "waived";
  startedOn?: string | null;
  completedOn?: string | null;
  submittedOn?: string | null;
  score?: number | null;
  progressPercent?: number;
  isProfessional?: boolean;
  notes?: string | null;
  assignedByName?: string | null;
};
type RecordItem = {
  id: string;
  employee: Employee;
  course: { id: string; code: string; name: string; category: string };
  completedOn: string;
  expiresOn?: string | null;
  result: "passed" | "failed" | "attended" | "in_progress";
  score?: number | null;
  trainer?: string | null;
  certificateNumber?: string | null;
  notes?: string | null;
  recordedByName?: string | null;
};
type Metrics = {
  courses: number;
  assigned: number;
  completed: number;
  dueSoon: number;
  overdue: number;
};

type TrainingManagerReport = {
  byStatus: Array<{ status: string; count: number }>;
  byCourse: Array<{ id: string; code: string; name: string; assigned: number; completed: number; needs_attention: number }>;
  byProvince: Array<{ province: string; assigned: number; completed: number }>;
  averageQuizScore: number | null;
  expiringCertificates: number;
};
type CourseTemplate = { id: string; name: string; category: string; lessonCount: number };
type QuestionBank = { id: string; name: string; description?: string | null; category?: string | null; question_count: number };
type CourseLibraryDocument = {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  category?: string | null;
};
const courseFileKind = (mimeType: string | null | undefined) => {
  const mime = String(mimeType ?? "").toLowerCase();
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  if (
    mime === "application/pdf" ||
    mime.startsWith("application/msword") ||
    mime.includes("officedocument") ||
    mime.startsWith("application/vnd.ms-") ||
    mime.startsWith("text/")
  )
    return "document";
  return "file";
};
const selectClass =
  "h-10 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20";
const label = (fr: boolean, english: string, french: string) =>
  fr ? french : english;
const words = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const assignmentStatus = (value: Assignment["status"], fr: boolean) =>
  value === "awaiting_review"
    ? label(fr, "Awaiting validation", "En attente de validation")
    : words(value);
const trainingCode = (value: string) => {
  const clean = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 58);
  return clean && /^[a-z]/.test(clean)
    ? clean
    : `training_${clean || "course"}`;
};
const date = (value: string | null | undefined, fr: boolean) =>
  value
    ? new Intl.DateTimeFormat(fr ? "fr-FR" : "en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(`${value.slice(0, 10)}T00:00:00`))
    : "—";
type QuizQuestionInput = {
  id: string;
  question: string;
  options: string[];
  correctOption: number;
};

function parseQuizLines(value: string, fr: boolean): QuizQuestionInput[] {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line, index) => {
    const cells = line
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean);
    if (cells.length < 4)
      throw new Error(
        label(
          fr,
          "Each quiz line needs a question, at least two answers, and the correct answer number.",
          "Chaque ligne du quiz doit contenir une question, au moins deux réponses et le numéro de la bonne réponse.",
        ),
      );
    const correct = Number(cells.at(-1));
    const options = cells.slice(1, -1);
    if (!Number.isInteger(correct) || correct < 1 || correct > options.length)
      throw new Error(
        label(
          fr,
          "The correct answer number must match one of the listed answers.",
          "Le numéro de la bonne réponse doit correspondre à une des réponses indiquées.",
        ),
      );
    return {
      id: "q_" + (index + 1),
      question: cells[0]!,
      options,
      correctOption: correct - 1,
    };
  });
}

const apiError = (error: unknown) =>
  error instanceof ApiError
    ? (Object.values(error.fieldErrors).flat()[0] ?? error.message)
    : error
      ? "Impossible de terminer cette action."
      : null;
const statusVariant = (
  value: Assignment["status"] | RecordItem["result"],
): "good" | "warning" | "serious" | "outline" | "info" =>
  ["completed", "passed", "attended"].includes(value)
    ? "good"
    : value === "overdue" || value === "failed"
      ? "serious"
      : value === "in_progress"
        ? "info"
        : value === "assigned"
          ? "warning"
          : "outline";

export function TrainingArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const user = useSessionUser();
  const client = useQueryClient();
  // The administrative training centre is intentionally separate from the learner portal.
  const canRead = can(user, "training.create");
  const canCreate = can(user, "training.create");
  const canUpdate = can(user, "training.create");
  const canReadEmployees = can(user, "employees.read");
  const [tab, setTab] = useState<"catalogue" | "assignments" | "history">(
    "catalogue",
  );
  const [selected, setSelected] = useState<Course | null>(null);
  const [courseDialog, setCourseDialog] = useState<Course | null | "new">(null);
  const [professionalBuilder, setProfessionalBuilder] = useState<
    { courseId?: string; versionId?: string } | true | null
  >(null);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [materialOpen, setMaterialOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [questionBankOpen, setQuestionBankOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [assignmentFilter, setAssignmentFilter] = useState("all");
  const [catalogueFilter, setCatalogueFilter] = useState<"active" | "archived">(
    "active",
  );
  const [courseSearch, setCourseSearch] = useState("");

  const courses = useQuery({
    queryKey: ["training-courses", orgSlug],
    queryFn: () =>
      get<{ courses: Course[] }>(orgUrl(orgSlug, "training-courses")),
    enabled: canRead,
    select: (data) => data.courses,
  });
  const assignments = useQuery({
    queryKey: ["training-assignments", orgSlug],
    queryFn: () =>
      get<{ assignments: Assignment[] }>(
        orgUrl(orgSlug, "training-assignments"),
      ),
    enabled: canRead,
    select: (data) => data.assignments,
  });
  const records = useQuery({
    queryKey: ["training-records", orgSlug],
    queryFn: () =>
      get<{ records: RecordItem[] }>(orgUrl(orgSlug, "training-records")),
    enabled: canRead,
    select: (data) => data.records,
  });
  const summary = useQuery({
    queryKey: ["training-summary", orgSlug],
    queryFn: () =>
      get<{ metrics: Metrics }>(orgUrl(orgSlug, "training-summary")),
    enabled: canRead,
  });
  const managerReport = useQuery({
    queryKey: ["training-manager-report", orgSlug],
    queryFn: () =>
      get<{ report: TrainingManagerReport }>(
        orgUrl(orgSlug, "training-manager-report"),
      ),
    enabled: canCreate && reportOpen,
  });  const materials = useQuery({
    queryKey: ["training-materials", orgSlug, selected?.id],
    queryFn: () =>
      get<{ materials: Material[] }>(
        orgUrl(orgSlug, `training-courses/${selected!.id}/materials`),
      ),
    enabled: canRead && Boolean(selected),
    select: (data) => data.materials,
  });
  const employees = useQuery({
    queryKey: ["training-employees", orgSlug],
    queryFn: () => get<{ employees: Employee[] }>(orgUrl(orgSlug, "employees")),
    enabled: canReadEmployees,
    select: (data) => data.employees,
  });
  const setCourseActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      patch<{ course: Course }>(
        orgUrl(orgSlug, `training-courses/${id}`),
        { isActive },
      ),
    onSuccess: (_result, variables) => {
      if (!variables.isActive) setSelected(null);
      void client.invalidateQueries({ queryKey: ["training-courses", orgSlug] });
      void client.invalidateQueries({ queryKey: ["training-summary", orgSlug] });
    },
  });
  const updateAssignment = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      patch<{ assignment: Assignment }>(
        orgUrl(orgSlug, `training-assignments/${id}`),
        body,
      ),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["training-assignments", orgSlug],
      });
      void client.invalidateQueries({
        queryKey: ["training-records", orgSlug],
      });
      void client.invalidateQueries({
        queryKey: ["training-summary", orgSlug],
      });
      void client.invalidateQueries({
        queryKey: ["training-courses", orgSlug],
      });
    },
  });
  const validateProfessionalAssignment = useMutation({
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) =>
      patch<{ assignment: Assignment }>(
        orgUrl(orgSlug, `training-assignments/${id}/professional-validation`),
        { approved },
      ),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["training-assignments", orgSlug],
      });
      void client.invalidateQueries({
        queryKey: ["training-records", orgSlug],
      });
      void client.invalidateQueries({
        queryKey: ["training-summary", orgSlug],
      });
      void client.invalidateQueries({
        queryKey: ["training-courses", orgSlug],
      });
    },
  });
  const visibleCourses = useMemo(() => {
    const query = courseSearch.trim().toLocaleLowerCase(fr ? "fr" : "en");
    return (courses.data ?? []).filter((course) => {
      const matchesLifecycle =
        catalogueFilter === "active" ? course.isActive : !course.isActive;
      if (!matchesLifecycle) return false;
      if (!query) return true;
      return [course.name, course.code, course.category, course.description]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase(fr ? "fr" : "en").includes(query));
    });
  }, [courses.data, catalogueFilter, courseSearch, fr]);
  const filteredAssignments = useMemo(
    () =>
      (assignments.data ?? []).filter(
        (assignment) =>
          assignmentFilter === "all" || assignment.status === assignmentFilter,
      ),
    [assignments.data, assignmentFilter],
  );
  if (!canRead)
    return <NoAccessState what={label(fr, "training", "la formation")} />;
  if (
    courses.isPending ||
    assignments.isPending ||
    records.isPending ||
    summary.isPending
  )
    return (
      <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        <SkeletonCard rows={9} />
      </main>
    );
  if (
    courses.isError ||
    assignments.isError ||
    records.isError ||
    summary.isError
  )
    return (
      <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        <ErrorState
          description={
            apiError(courses.error) ||
            apiError(assignments.error) ||
            apiError(records.error) ||
            apiError(summary.error) ||
            undefined
          }
          onRetry={() => {
            void courses.refetch();
            void assignments.refetch();
            void records.refetch();
            void summary.refetch();
          }}
        />
      </main>
    );
  const metrics = summary.data?.metrics ?? {
    courses: 0,
    assigned: 0,
    completed: 0,
    dueSoon: 0,
    overdue: 0,
  };
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <header className="relative overflow-hidden rounded-3xl border border-indigo-300/20 bg-[radial-gradient(circle_at_91%_9%,rgba(165,146,255,.34),transparent_23%),radial-gradient(circle_at_6%_115%,rgba(35,211,171,.26),transparent_37%),linear-gradient(132deg,#10224e,#233c84_53%,#5633ad)] p-5 text-white shadow-[0_26px_66px_-38px_rgba(20,37,94,.95)] sm:p-7">
        <span className="pointer-events-none absolute -right-16 top-12 size-64 rounded-full border border-white/10" />
        <span className="pointer-events-none absolute -right-4 top-24 size-40 rounded-full border border-white/10" />
        <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-end">
          <div className="max-w-3xl">
            <p className="text-[11px] font-bold uppercase tracking-[.2em] text-indigo-100/85">
              {label(fr, "Capability & compliance", "Compétences et conformité")}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              {label(fr, "Training centre", "Centre de formation")}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-indigo-50/90">
              {label(
                fr,
                "Build reliable teams with required learning, controlled evidence and clear completion dates.",
                "Pilotez les compétences, les obligations et les preuves de formation de chaque équipe depuis un seul espace.",
              )}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/95">
                <LibraryBig className="size-3.5" />
                {metrics.courses} {label(fr, "active courses", "formations actives")}
              </span>
              <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${metrics.overdue ? "border-rose-200/25 bg-rose-400/15 text-rose-50" : "border-emerald-200/20 bg-emerald-400/12 text-emerald-50"}`}>
                <CircleAlert className="size-3.5" />
                {metrics.overdue
                  ? `${metrics.overdue} ${label(fr, "overdue", "à relancer")}`
                  : label(fr, "No overdue learning", "Aucun parcours en retard")}
              </span>
            </div>
          </div>
          {canCreate ? (
            <div className="rounded-2xl border border-white/15 bg-slate-950/15 p-3 shadow-xl shadow-indigo-950/10 backdrop-blur-sm">
              <p className="px-1 pb-2 text-[10px] font-bold uppercase tracking-[.16em] text-indigo-100/75">
                {label(fr, "Quick actions", "Actions rapides")}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  className="col-span-2 bg-white text-indigo-900 shadow-sm hover:bg-indigo-50"
                  onClick={() => setProfessionalBuilder(true)}
                >
                  <GraduationCap />
                  {label(fr, "Create professional course", "Créer un cours professionnel")}
                </Button>
                <Button
                  variant="secondary"
                  className="border-white/15 bg-white/10 text-white hover:bg-white/20"
                  onClick={() => setAssignmentOpen(true)}
                >
                  <Users />
                  {label(fr, "Assign", "Affecter")}
                </Button>
                <Button
                  variant="secondary"
                  className="border-white/15 bg-white/10 text-white hover:bg-white/20"
                  onClick={() => setReportOpen(true)}
                >
                  <BookOpenCheck />
                  {label(fr, "Reports", "Rapports")}
                </Button>
              </div>
              <details className="group mt-2 rounded-xl border border-white/10 bg-white/[.055]">
                <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-semibold text-indigo-50 marker:hidden">
                  {label(fr, "More training tools", "Autres outils de formation")}
                  <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
                </summary>
                <div className="grid gap-1 border-t border-white/10 p-2 sm:grid-cols-2">
                  <Button size="sm" variant="ghost" className="justify-start text-white hover:bg-white/10 hover:text-white" onClick={() => setCourseDialog("new")}>
                    <Plus />{label(fr, "Quick training", "Formation simple")}
                  </Button>
                  <Button size="sm" variant="ghost" className="justify-start text-white hover:bg-white/10 hover:text-white" onClick={() => setTemplatesOpen(true)}>
                    <LibraryBig />{label(fr, "Templates", "Modèles")}
                  </Button>
                  <Button size="sm" variant="ghost" className="justify-start text-white hover:bg-white/10 hover:text-white" onClick={() => setQuestionBankOpen(true)}>
                    <ClipboardCheck />{label(fr, "Question bank", "Banque de questions")}
                  </Button>
                  <Button size="sm" variant="ghost" className="justify-start text-white hover:bg-white/10 hover:text-white" onClick={() => setRecordOpen(true)}>
                    <Award />{label(fr, "Record completion", "Enregistrer une réussite")}
                  </Button>
                </div>
              </details>
            </div>
          ) : null}
        </div>
      </header>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric
          icon={LibraryBig}
          title={label(fr, "Active catalogue", "Catalogue actif")}
          value={metrics.courses}
          text={label(fr, "Courses available", "Formations disponibles")}
          tone="brand"
        />
        <Metric
          icon={ClipboardCheck}
          title={label(fr, "Assigned", "Affectées")}
          value={metrics.assigned}
          text={label(fr, "Required learning", "Parcours à suivre")}
        />
        <Metric
          icon={CheckCircle2}
          title={label(fr, "Completed", "Terminées")}
          value={metrics.completed}
          text={label(fr, "Validated completions", "Réussites validées")}
          tone="good"
        />
        <Metric
          icon={CalendarClock}
          title={label(fr, "Due soon", "Échéances proches")}
          value={metrics.dueSoon}
          text={label(fr, "Within 14 days", "Dans les 14 jours")}
          tone="warning"
        />
        <Metric
          icon={CircleAlert}
          title={label(fr, "Overdue", "En retard")}
          value={metrics.overdue}
          text={label(fr, "Needs follow-up", "À relancer")}
          tone="serious"
        />
      </section>
      <nav className="flex w-full gap-1 overflow-x-auto rounded-2xl border border-border bg-surface-1 p-1.5 shadow-sm">
        {[
          ["catalogue", LibraryBig, label(fr, "Catalogue", "Catalogue")],
          [
            "assignments",
            ClipboardCheck,
            label(fr, "Learning paths", "Parcours"),
          ],
          ["history", Award, label(fr, "Certificates", "Certificats")],
        ].map(([value, Icon, text]) => (
          <button
            key={String(value)}
            type="button"
            onClick={() => setTab(value as typeof tab)}
            className={`inline-flex min-w-max items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${tab === value ? "bg-brand text-white shadow-sm" : "text-ink-secondary hover:bg-surface-2 hover:text-ink"}`}
          >
            {typeof Icon === "function" ? <Icon className="size-4" /> : null}
            {String(text)}
          </button>
        ))}
      </nav>
      {tab === "catalogue" ? (
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.18fr)_minmax(20rem,.82fr)]">
          <section className="overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
              <div>
                <h2 className="text-base font-semibold text-ink">
                  {label(fr, "Course catalogue", "Catalogue de formations")}
                </h2>
                <p className="mt-1 text-xs leading-5 text-ink-secondary">
                  {label(
                    fr,
                    "Open a course to read its materials and see completion progress.",
                    "Ouvrez une formation pour consulter ses supports et suivre les complétions.",
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Input
                  className="h-9 w-52 bg-surface-2/70 text-xs"
                  value={courseSearch}
                  onChange={(event) => setCourseSearch(event.target.value)}
                  placeholder={label(fr, "Search a course…", "Rechercher une formation…")}
                  aria-label={label(fr, "Search the course catalogue", "Rechercher dans le catalogue de formations")}
                />
                <div
                  className="inline-flex rounded-xl border border-border bg-surface-2 p-1"
                  role="tablist"
                  aria-label={label(fr, "Course catalogue filter", "Filtre du catalogue de formations")}
                >
                  {([
                    ["active", label(fr, "Active", "Actives")],
                    ["archived", label(fr, "Archived", "Archivées")],
                  ] as const).map(([value, text]) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={catalogueFilter === value}
                      onClick={() => setCatalogueFilter(value)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${catalogueFilter === value ? "bg-surface-1 text-ink shadow-sm" : "text-ink-secondary hover:text-ink"}`}
                    >
                      {text}
                    </button>
                  ))}
                </div>
                {canCreate ? (
                  <Button size="sm" onClick={() => setCourseDialog("new")}>
                    <Plus />
                    {label(fr, "Add course", "Ajouter")}
                  </Button>
                ) : null}
              </div>
            </div>
            {(courses.data ?? []).length ? (
              <div className="grid gap-3 p-4 sm:grid-cols-2">
                {visibleCourses.map((course) => {
                  const completionRate = course.assignmentCount
                    ? Math.round(
                        (course.completedCount / course.assignmentCount) * 100,
                      )
                    : 0;
                  const isSelected = selected?.id === course.id;
                  return (
                    <button
                      key={course.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setSelected(course)}
                      className={`group relative overflow-hidden rounded-2xl border p-4 text-left transition duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
                        isSelected
                          ? "border-brand/50 bg-brand/[0.055] shadow-lg shadow-brand/10"
                          : "border-border bg-surface-1 hover:-translate-y-0.5 hover:border-brand/35 hover:bg-surface-2 hover:shadow-lg"
                      }`}
                    >
                      <span className="pointer-events-none absolute -right-8 -top-8 size-28 rounded-full bg-brand/10 blur-2xl transition group-hover:bg-brand/20" />
                      <div className="relative">
                        <div className="flex items-start justify-between gap-3">
                          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand to-indigo-600 text-white shadow-lg shadow-brand/20">
                            <GraduationCap className="size-5" />
                          </span>
                          <span className="flex flex-wrap justify-end gap-1.5">
                            {course.isMandatory ? (
                              <Badge variant="warning">
                                {label(fr, "Required", "Obligatoire")}
                              </Badge>
                            ) : (
                              <Badge variant="outline">
                                {label(fr, "Optional", "Facultative")}
                              </Badge>
                            )}
                            {!course.isActive ? (
                              <Badge variant="outline">
                                {label(fr, "Inactive", "Inactive")}
                              </Badge>
                            ) : null}
                          </span>
                        </div>

                        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-brand">
                          {words(course.category)} · {course.code}
                        </p>
                        <h3 className="mt-1 line-clamp-1 text-base font-semibold text-ink">
                          {course.name}
                        </h3>
                        <p className="mt-1.5 line-clamp-2 min-h-10 text-xs leading-5 text-ink-secondary">
                          {course.description ||
                            label(
                              fr,
                              "Course content and completion requirements.",
                              "Contenu de la formation et conditions de réussite.",
                            )}
                        </p>

                        <div className="mt-4 grid grid-cols-3 overflow-hidden rounded-xl border border-border bg-surface-2/70">
                          <span className="border-r border-border px-2.5 py-2.5">
                            <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                              {label(fr, "Assigned", "Affectées")}
                            </span>
                            <span className="mt-0.5 block text-sm font-bold tabular-nums text-ink">
                              {course.assignmentCount}
                            </span>
                          </span>
                          <span className="border-r border-border px-2.5 py-2.5">
                            <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                              {label(fr, "Completed", "Terminées")}
                            </span>
                            <span className="mt-0.5 block text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                              {course.completedCount}
                            </span>
                          </span>
                          <span className="px-2.5 py-2.5">
                            <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                              {label(fr, "Validity", "Validité")}
                            </span>
                            <span className="mt-0.5 block truncate text-sm font-bold text-ink">
                              {course.validityMonths
                                ? `${course.validityMonths} ${label(fr, "mo.", "mois")}`
                                : "—"}
                            </span>
                          </span>
                        </div>

                        <div className="mt-4">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-ink-secondary">
                              {label(fr, "Completion", "Progression")}
                            </span>
                            <span className="font-bold tabular-nums text-ink">
                              {completionRate}%
                            </span>
                          </div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
                            <span
                              className="block h-full rounded-full bg-gradient-to-r from-brand to-indigo-500 transition-[width]"
                              style={{ width: `${completionRate}%` }}
                            />
                          </div>
                        </div>

                        <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs font-semibold text-brand">
                          <span>
                            {label(fr, "Ouvrir la formation", "Open training")}
                          </span>
                          <ChevronRight
                            className={`size-4 transition-transform ${isSelected ? "translate-x-0.5" : "group-hover:translate-x-0.5"}`}
                          />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                icon={GraduationCap}
                title={label(
                  fr,
                  "No training yet",
                  "Aucune formation pour le moment",
                )}
                description={label(
                  fr,
                  "Create your first induction, safety or technical course.",
                  "Créez votre première formation d’accueil, sécurité ou technique.",
                )}
                action={
                  canCreate
                    ? {
                        label: label(
                          fr,
                          "Create training",
                          "Créer une formation",
                        ),
                        onClick: () => setCourseDialog("new"),
                      }
                    : undefined
                }
              />
            )}
          </section>
          <CourseDetail
            course={selected}
            materials={materials.data ?? []}
            loading={materials.isPending}
            orgSlug={orgSlug}
            fr={fr}
            canUpdate={canCreate}
            canCreate={canCreate}
            onEdit={() => selected && setCourseDialog(selected)}
            onAddMaterial={() => setMaterialOpen(true)}
            onOpenProfessionalBuilder={() =>
              selected && setProfessionalBuilder({ courseId: selected.id })
            }
            archivePending={setCourseActive.isPending}
            onSetActive={(course) => {
              if (
                course.isActive &&
                typeof window !== "undefined" &&
                !window.confirm(
                  fr
                    ? `Archiver « ${course.name} » ? Elle ne sera plus affectable, mais les parcours et certificats resteront conservés.`
                    : `Archive “${course.name}”? It can no longer be assigned, while learning history and certificates remain preserved.`,
                )
              )
                return;
              setCourseActive.mutate({ id: course.id, isActive: !course.isActive });
            }}
          />
        </section>
      ) : null}
      {tab === "assignments" ? (
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(19rem,.75fr)]">
          <section className="overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
              <div>
                <h2 className="text-base font-semibold text-ink">
                  {label(
                    fr,
                    "Employee learning paths",
                    "Parcours des employés",
                  )}
                </h2>
                <p className="mt-1 text-xs leading-5 text-ink-secondary">
                  {label(
                    fr,
                    "Every assignment has an owner, an optional deadline and a verifiable completion record.",
                    "Chaque affectation a un responsable, une échéance éventuelle et une preuve de complétion.",
                  )}
                </p>
              </div>
              <select
                className={`${selectClass} w-44`}
                value={assignmentFilter}
                onChange={(event) => setAssignmentFilter(event.target.value)}
              >
                <option value="all">
                  {label(fr, "All statuses", "Tous les statuts")}
                </option>
                {[
                  "assigned",
                  "in_progress",
                  "awaiting_review",
                  "completed",
                  "overdue",
                  "waived",
                ].map((value) => (
                  <option key={value} value={value}>
                    {assignmentStatus(value as Assignment["status"], fr)}
                  </option>
                ))}
              </select>
            </div>
            {filteredAssignments.length ? (
              <div className="divide-y divide-border">
                {filteredAssignments.map((assignment) => (
                  <article
                    key={assignment.id}
                    className="flex flex-wrap items-center gap-3 px-5 py-4"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-3 text-brand">
                      <BookOpenCheck className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-ink">
                          {assignment.course.name}
                        </p>
                        <Badge variant={statusVariant(assignment.status)}>
                          {assignmentStatus(assignment.status, fr)}
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-xs text-ink-secondary">
                        {assignment.employee.fullName} · #
                        {assignment.employee.employeeNumber} ·{" "}
                        {assignment.site?.name ??
                          assignment.province?.name ??
                          "—"}
                      </p>
                      <p className="mt-1 text-xs text-ink-muted">
                        {label(fr, "Due", "Échéance")} :{" "}
                        {date(assignment.dueOn, fr)} ·{" "}
                        {label(fr, "Assigned", "Affectée")} :{" "}
                        {date(assignment.assignedOn, fr)}
                      </p>{" "}
                      <div className="mt-3 max-w-xs">
                        <div className="flex justify-between text-[11px] font-medium text-ink-muted">
                          <span>
                            {label(
                              fr,
                              "Verified progress",
                              "Progression vérifiée",
                            )}
                          </span>
                          <span>{assignment.progressPercent ?? 0}%</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                          <div
                            className="h-full rounded-full bg-brand"
                            style={{
                              width: `${assignment.progressPercent ?? 0}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          const course = (courses.data ?? []).find(
                            (item) => item.id === assignment.course.id,
                          );
                          if (course) {
                            setSelected(course);
                            setTab("catalogue");
                          }
                        }}
                      >
                        <BookOpenCheck />
                        {label(fr, "Open course", "Ouvrir la formation")}
                      </Button>
                      {canUpdate &&
                      !["completed", "waived"].includes(assignment.status) ? (
                        <>
                          {assignment.status === "assigned" ||
                          assignment.status === "overdue" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={updateAssignment.isPending}
                              onClick={() =>
                                updateAssignment.mutate({
                                  id: assignment.id,
                                  body: { status: "in_progress" },
                                })
                              }
                            >
                              {label(fr, "Start", "Démarrer")}
                            </Button>
                          ) : null}
                          {!canCreate &&
                          !assignment.isProfessional &&
                          assignment.status === "in_progress" ? (
                            <Button
                              size="sm"
                              loading={updateAssignment.isPending}
                              onClick={() =>
                                updateAssignment.mutate({
                                  id: assignment.id,
                                  body: { status: "awaiting_review" },
                                })
                              }
                            >
                              <ClipboardCheck />
                              {label(
                                fr,
                                "Submit for validation",
                                "Soumettre à validation",
                              )}
                            </Button>
                          ) : null}
                          {canCreate &&
                          assignment.status === "awaiting_review" ? (
                            <Button
                              size="sm"
                              loading={
                                assignment.isProfessional
                                  ? validateProfessionalAssignment.isPending
                                  : updateAssignment.isPending
                              }
                              onClick={() =>
                                assignment.isProfessional
                                  ? validateProfessionalAssignment.mutate({
                                      id: assignment.id,
                                      approved: true,
                                    })
                                  : updateAssignment.mutate({
                                      id: assignment.id,
                                      body: { status: "completed" },
                                    })
                              }
                            >
                              <CheckCircle2 />
                              {label(
                                fr,
                                "Validate completion",
                                "Valider la formation",
                              )}
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                      {assignment.status === "awaiting_review" && !canCreate ? (
                        <span className="inline-flex items-center rounded-lg bg-warning/15 px-3 py-2 text-xs font-semibold text-warning-ink">
                          {label(
                            fr,
                            "Awaiting manager validation",
                            "En attente de validation par le responsable",
                          )}
                        </span>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={ClipboardCheck}
                title={label(
                  fr,
                  "No learning assignment",
                  "Aucun parcours dans cette vue",
                )}
                description={label(
                  fr,
                  "A manager can assign a course to begin the employee’s learning path.",
                  "Un gestionnaire peut affecter une formation pour démarrer le parcours d’un employé.",
                )}
              />
            )}
          </section>
          <aside className="rounded-2xl border border-border bg-surface-1 p-5 shadow-sm">
            <ShieldCheck className="size-6 text-brand" />
            <h2 className="mt-4 text-base font-semibold text-ink">
              {label(
                fr,
                "Completion is traceable",
                "La complétion est traçable",
              )}
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">
              {label(
                fr,
                "Starting and completing a course keeps the employee, dates, result and renewal period together. A completed assignment creates a training record automatically.",
                "Le démarrage et la complétion conservent l’employé, les dates, le résultat et la période de renouvellement. Une affectation terminée crée automatiquement un enregistrement de formation.",
              )}
            </p>
            <div className="mt-5 rounded-xl bg-brand/5 p-4 text-sm text-ink-secondary">
              <b className="block text-ink">
                {label(fr, "For employees", "Pour les employés")}
              </b>
              <p className="mt-1">
                {label(
                  fr,
                  "Open your assigned course, review every required support, then submit it for validation. Your manager confirms the completion.",
                  "Ouvrez votre formation affectée, consultez chaque support requis, puis soumettez-la à validation. Votre responsable confirme la réussite.",
                )}
              </p>
            </div>
          </aside>
        </section>
      ) : null}
      {tab === "history" ? (
        <section className="overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
            <div>
              <h2 className="text-base font-semibold text-ink">
                {label(
                  fr,
                  "Certificates & history",
                  "Certificats et historique",
                )}
              </h2>
              <p className="mt-1 text-xs text-ink-secondary">
                {label(
                  fr,
                  "Completed learning stays with the employee, including expiry dates for renewals.",
                  "Les formations terminées restent liées à l’employé, avec les dates d’expiration pour les renouvellements.",
                )}
              </p>
            </div>
            {canCreate ? (
              <Button size="sm" onClick={() => setRecordOpen(true)}>
                <Plus />
                {label(fr, "Add record", "Ajouter")}
              </Button>
            ) : null}
          </div>
          {(records.data ?? []).length ? (
            <div className="divide-y divide-border">
              {(records.data ?? []).map((record) => (
                <article
                  key={record.id}
                  className="flex flex-wrap items-center gap-3 px-5 py-4"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-good/10 text-good-ink">
                    <Award className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-ink">
                        {record.course.name}
                      </p>
                      <Badge variant={statusVariant(record.result)}>
                        {words(record.result)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-ink-secondary">
                      {record.employee.fullName} · #
                      {record.employee.employeeNumber} ·{" "}
                      {label(fr, "completed", "terminée")}{" "}
                      {date(record.completedOn, fr)}
                    </p>
                  </div>
                  <div className="text-right text-xs text-ink-secondary">
                    <p>
                      {label(fr, "Expires", "Expire")} :{" "}
                      {date(record.expiresOn, fr)}
                    </p>
                    {record.certificateNumber ? (
                      <p className="mt-1 font-medium text-ink">
                        {record.certificateNumber}
                      </p>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Award}
              title={label(
                fr,
                "No training record yet",
                "Aucun certificat pour le moment",
              )}
              description={label(
                fr,
                "Completed assignments will appear here automatically.",
                "Les affectations terminées apparaîtront ici automatiquement.",
              )}
            />
          )}
        </section>
      ) : null}
      {courseDialog ? (
        <CourseDialog
          fr={fr}
          orgSlug={orgSlug}
          course={courseDialog === "new" ? null : courseDialog}
          onClose={() => setCourseDialog(null)}
        />
      ) : null}{" "}
      {professionalBuilder ? (
        <ProfessionalCourseBuilder
          fr={fr}
          orgSlug={orgSlug}
          initial={
            professionalBuilder === true ? undefined : professionalBuilder
          }
          onClose={() => setProfessionalBuilder(null)}
        />
      ) : null}
      {assignmentOpen ? (
        <AssignmentDialog
          fr={fr}
          orgSlug={orgSlug}
          courses={courses.data ?? []}
          employees={employees.data ?? []}
          hasEmployeeAccess={canReadEmployees}
          onClose={() => setAssignmentOpen(false)}
        />
      ) : null}
      {materialOpen && selected ? (
        <MaterialDialog
          fr={fr}
          orgSlug={orgSlug}
          course={selected}
          onClose={() => setMaterialOpen(false)}
        />
      ) : null}
      {recordOpen ? (
        <RecordDialog
          fr={fr}
          orgSlug={orgSlug}
          courses={courses.data ?? []}
          employees={employees.data ?? []}
          hasEmployeeAccess={canReadEmployees}
          onClose={() => setRecordOpen(false)}
        />
      ) : null}      {templatesOpen ? (
        <CourseTemplatesDialog
          fr={fr}
          orgSlug={orgSlug}
          onCreated={(course) => {
            setTemplatesOpen(false);
            setProfessionalBuilder(course);
            void client.invalidateQueries({ queryKey: ["training-courses", orgSlug] });
          }}
          onClose={() => setTemplatesOpen(false)}
        />
      ) : null}
      {questionBankOpen ? (
        <QuestionBankDialog
          fr={fr}
          orgSlug={orgSlug}
          onClose={() => setQuestionBankOpen(false)}
        />
      ) : null}
      {reportOpen ? (
        <TrainingReportDialog
          fr={fr}
          report={managerReport.data?.report}
          loading={managerReport.isPending}
          error={apiError(managerReport.error)}
          onRetry={() => void managerReport.refetch()}
          onClose={() => setReportOpen(false)}
        />
      ) : null}
    </main>
  );
}

function CourseTemplatesDialog({
  fr,
  orgSlug,
  onCreated,
  onClose,
}: {
  fr: boolean;
  orgSlug: string;
  onCreated: (course: { courseId: string; versionId: string }) => void;
  onClose: () => void;
}) {
  const templates = useQuery({
    queryKey: ["training-course-templates"],
    queryFn: () => get<{ templates: CourseTemplate[] }>(orgUrl(orgSlug, "training-course-templates")),
  });
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      post<{ course: { courseId: string; versionId: string } }>(
        orgUrl(orgSlug, "training-course-templates/drafts"),
        body,
      ),
    onSuccess: (result) => onCreated(result.course),
  });
  return (
    <Dialog title={label(fr, "Course templates", "Modèles de cours")} onClose={onClose}>
      <p className="mb-4 text-sm leading-6 text-ink-secondary">
        {label(fr, "Each template creates an editable draft. Nothing is assigned or published automatically.", "Chaque modèle crée un brouillon modifiable. Rien n’est affecté ou publié automatiquement.")}
      </p>
      {apiError(create.error) ? <p className="mb-3 rounded-xl border border-critical/25 bg-critical/10 p-3 text-sm text-critical">{apiError(create.error)}</p> : null}
      {templates.isPending ? <SkeletonCard rows={4} /> : templates.isError ? <ErrorState description={apiError(templates.error) ?? undefined} onRetry={() => void templates.refetch()} /> : (
        <div className="grid gap-3 sm:grid-cols-2">
          {(templates.data?.templates ?? []).map((template) => (
            <form key={template.id} className="rounded-2xl border border-border bg-surface-2 p-4" onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              create.mutate({ templateId: template.id, code: trainingCode(String(form.get("code") ?? template.name)), completionMode: String(form.get("completionMode") ?? "manager_validation") });
            }}>
              <Badge variant="outline">{words(template.category)}</Badge>
              <h3 className="mt-3 text-sm font-semibold text-ink">{template.name}</h3>
              <p className="mt-1 text-xs text-ink-secondary">{template.lessonCount} {label(fr, "starter lessons", "leçons de départ")}</p>
              <Input className="mt-3" name="code" defaultValue={trainingCode(template.name)} aria-label={label(fr, "Course code", "Code du cours")} />
              <select className={`${selectClass} mt-2`} name="completionMode" defaultValue="manager_validation">
                <option value="manager_validation">{label(fr, "Manager validation", "Validation responsable")}</option>
                <option value="automatic">{label(fr, "Automatic completion", "Complétion automatique")}</option>
              </select>
              <Button className="mt-3 w-full" size="sm" type="submit" loading={create.isPending}><Plus />{label(fr, "Create editable draft", "Créer le brouillon")}</Button>
            </form>
          ))}
        </div>
      )}
    </Dialog>
  );
}

function QuestionBankDialog({ fr, orgSlug, onClose }: { fr: boolean; orgSlug: string; onClose: () => void }) {
  const client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const banks = useQuery({ queryKey: ["training-question-banks", orgSlug], queryFn: () => get<{ questionBanks: QuestionBank[] }>(orgUrl(orgSlug, "training-question-banks")) });
  const questions = useQuery({ queryKey: ["training-questions", orgSlug, selected], queryFn: () => get<{ questions: Array<{ id: string; prompt: string; question_type: string; points: number; requires_manual_grading: boolean }> }>(orgUrl(orgSlug, `training-question-banks/${selected}/questions`)), enabled: Boolean(selected) });
  const refresh = () => void client.invalidateQueries({ queryKey: ["training-question-banks", orgSlug] });
  const createBank = useMutation({ mutationFn: (body: Record<string, unknown>) => post(orgUrl(orgSlug, "training-question-banks"), body), onSuccess: refresh });
  const createQuestion = useMutation({ mutationFn: (body: Record<string, unknown>) => post(orgUrl(orgSlug, `training-question-banks/${selected}/questions`), body), onSuccess: () => void client.invalidateQueries({ queryKey: ["training-questions", orgSlug, selected] }) });
  const error = apiError(createBank.error) ?? apiError(createQuestion.error);
  return (
    <Dialog title={label(fr, "Question bank", "Banque de questions")} onClose={onClose}>
      <p className="text-sm leading-6 text-ink-secondary">{label(fr, "Build reviewed questions once, then reuse them when creating assessed lessons. Correct answers stay on the server.", "Créez des questions relues une seule fois, puis réutilisez-les dans les leçons évaluées. Les bonnes réponses restent sur le serveur.")}</p>
      {error ? <p className="mt-3 rounded-xl border border-critical/25 bg-critical/10 p-3 text-sm text-critical">{error}</p> : null}
      <form className="mt-4 grid gap-2 sm:grid-cols-[1fr_8rem_auto]" onSubmit={(event) => { event.preventDefault(); const form=new FormData(event.currentTarget); createBank.mutate({ name:String(form.get("name")??"").trim(), category:String(form.get("category")??"").trim()||null, description:null }); event.currentTarget.reset(); }}>
        <Input name="name" required placeholder={label(fr, "Bank name", "Nom de la banque")} />
        <Input name="category" placeholder={label(fr, "Category", "Catégorie")} />
        <Button type="submit" size="sm" loading={createBank.isPending}><Plus />{label(fr, "Add", "Ajouter")}</Button>
      </form>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)]">
        <div className="space-y-2">
          {(banks.data?.questionBanks ?? []).length ? (banks.data?.questionBanks ?? []).map((bank) => <button key={bank.id} type="button" onClick={() => setSelected(bank.id)} className={`w-full rounded-xl border p-3 text-left transition ${selected===bank.id ? "border-brand/40 bg-brand/5" : "border-border hover:bg-surface-2"}`}><p className="text-sm font-semibold text-ink">{bank.name}</p><p className="mt-1 text-xs text-ink-secondary">{bank.question_count} {label(fr, "question(s)", "question(s)")}{bank.category ? ` · ${bank.category}` : ""}</p></button>) : <EmptyState title={label(fr, "No question bank", "Aucune banque")} description={label(fr, "Create a reusable assessment bank.", "Créez une banque d’évaluation réutilisable.")} />}
        </div>
        <div className="rounded-xl border border-border bg-surface-2 p-4">
          {selected ? <>
            <h3 className="text-sm font-semibold text-ink">{label(fr, "Questions", "Questions")}</h3>
            <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const type=String(form.get("questionType")??"single_choice"); const answer=String(form.get("correctAnswer")??"").trim(); const options=String(form.get("options")??"").split(/\r?\n/).map((item)=>item.trim()).filter(Boolean); createQuestion.mutate({ questionType:type, prompt:String(form.get("prompt")??"").trim(), options, correctAnswer:answer, explanation:String(form.get("explanation")??"").trim()||null, sourceReference:String(form.get("sourceReference")??"").trim()||null, points:Number(form.get("points")||1), requiresManualGrading:type==="short_written" }); event.currentTarget.reset(); }}>
              <select className={selectClass} name="questionType" defaultValue="single_choice"><option value="single_choice">{label(fr, "Single choice", "Choix unique")}</option><option value="multiple_choice">{label(fr, "Multiple choice", "Choix multiples")}</option><option value="true_false">{label(fr, "True / false", "Vrai / faux")}</option><option value="short_written">{label(fr, "Written response", "Réponse écrite")}</option><option value="numerical">{label(fr, "Numerical", "Réponse numérique")}</option><option value="scenario">{label(fr, "Scenario", "Scénario")}</option></select>
              <Textarea name="prompt" rows={3} required placeholder={label(fr, "Question", "Question")} />
              <Textarea name="options" rows={3} placeholder={label(fr, "Options, one per line", "Options, une par ligne")} />
              <Input name="correctAnswer" required placeholder={label(fr, "Correct answer", "Bonne réponse")} />
              <div className="grid grid-cols-2 gap-2"><Input name="points" type="number" min="1" defaultValue="1" /><Input name="sourceReference" placeholder={label(fr, "Source reference", "Référence source")} /></div>
              <Textarea name="explanation" rows={2} placeholder={label(fr, "Explanation after marking", "Explication après correction")} />
              <Button type="submit" size="sm" loading={createQuestion.isPending}><Plus />{label(fr, "Add question", "Ajouter une question")}</Button>
            </form>
            <div className="mt-4 space-y-2">{questions.isPending ? <p className="text-xs text-ink-secondary">{label(fr, "Loading…", "Chargement…")}</p> : (questions.data?.questions ?? []).map((question) => <div key={question.id} className="rounded-lg border border-border bg-surface-1 p-3"><Badge variant="outline">{words(question.question_type)}</Badge><p className="mt-2 text-sm text-ink">{question.prompt}</p><p className="mt-1 text-xs text-ink-muted">{question.points} pt{question.points !== 1 ? "s" : ""}{question.requires_manual_grading ? ` · ${label(fr,"manual grading","correction manuelle")}` : ""}</p></div>)}</div>
          </> : <EmptyState title={label(fr, "Select a bank", "Sélectionnez une banque")} description={label(fr, "Choose a bank to create and review its questions.", "Choisissez une banque pour créer et relire ses questions.")} />}
        </div>
      </div>
    </Dialog>
  );
}

function TrainingReportDialog({ fr, report, loading, error, onRetry, onClose }: { fr: boolean; report?: TrainingManagerReport; loading: boolean; error: string | null; onRetry: () => void; onClose: () => void }) {
  return <Dialog title={label(fr, "Training reporting", "Rapports de formation")} onClose={onClose}>
    {loading ? <SkeletonCard rows={8} /> : error ? <ErrorState description={error} onRetry={onRetry} /> : report ? <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3"><Info title={label(fr,"Average quiz score","Score moyen aux quiz")} value={report.averageQuizScore == null ? "—" : `${report.averageQuizScore}%`} /><Info title={label(fr,"Certificates expiring within 30 days","Certificats expirant sous 30 jours")} value={String(report.expiringCertificates)} /></div>
      <ReportRows title={label(fr,"Assignments by status","Affectations par statut")} rows={report.byStatus.map((row)=>[words(row.status),String(row.count)])} />
      <ReportRows title={label(fr,"Completion by course","Achèvement par cours")} rows={report.byCourse.map((row)=>[row.name,`${row.completed}/${row.assigned} · ${row.needs_attention} ${label(fr,"need attention","à suivre")}`])} />
      <ReportRows title={label(fr,"Completion by province","Achèvement par province")} rows={report.byProvince.map((row)=>[row.province,`${row.completed}/${row.assigned}`])} />
    </div> : <EmptyState title={label(fr,"No reporting data","Aucune donnée de rapport")} description={label(fr,"Assign a course to begin reporting.","Affectez un cours pour démarrer le reporting.")} />}
  </Dialog>;
}
function ReportRows({ title, rows }: { title: string; rows: Array<[string,string]> }) { return <section className="rounded-xl border border-border"><h3 className="border-b border-border px-4 py-3 text-sm font-semibold text-ink">{title}</h3>{rows.length ? <div className="divide-y divide-border">{rows.map(([name,value])=><div key={`${name}-${value}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span className="min-w-0 truncate text-ink">{name}</span><span className="shrink-0 font-medium text-ink-secondary">{value}</span></div>)}</div> : <p className="p-4 text-sm text-ink-secondary">—</p>}</section>; }
function ProfessionalCourseBuilder({
  fr,
  orgSlug,
  initial,
  onClose,
}: {
  fr: boolean;
  orgSlug: string;
  initial?: { courseId?: string; versionId?: string };
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [courseRef, setCourseRef] = useState(initial ?? {});
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [aiDraftText, setAiDraftText] = useState<string | null>(null);
  const [aiOutlineDraft, setAiOutlineDraft] = useState<Record<string, unknown> | null>(null);
  const [replaceAiOutline, setReplaceAiOutline] = useState(false);
  const [aiImportMessage, setAiImportMessage] = useState<string | null>(null);
  const [aiAssistantOpen, setAiAssistantOpen] = useState(false);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [uploadedDocumentId, setUploadedDocumentId] = useState<string | null>(
    null,
  );
  const builder = useQuery({
    queryKey: [
      "professional-course-builder",
      orgSlug,
      courseRef.courseId,
      courseRef.versionId,
    ],
    queryFn: () =>
      get<any>(
        `${orgUrl(orgSlug, `training-courses/${courseRef.courseId}/builder`)}${courseRef.versionId ? `?versionId=${courseRef.versionId}` : ""}`,
      ),
    enabled: Boolean(courseRef.courseId),
  });
  const documents = useQuery({
    queryKey: ["professional-course-documents", orgSlug],
    queryFn: () =>
      get<{ documents: CourseLibraryDocument[] }>(orgUrl(orgSlug, "documents")),
    enabled: Boolean(courseRef.courseId),
  });
  const courseDocuments = useMemo(
    () =>
      [...(documents.data?.documents ?? [])]
        .filter((document) => Boolean(document.id && (document.title || document.fileName)))
        .sort((left, right) =>
          String(left.title || left.fileName).localeCompare(
            String(right.title || right.fileName),
            fr ? "fr" : "en",
          ),
        ),
    [documents.data?.documents, fr],
  );
  const courseDocumentGroups = [
    {
      key: "document",
      name: label(fr, "PDF and Office documents", "Documents PDF et Office"),
    },
    { key: "video", name: label(fr, "Videos", "Vidéos") },
    { key: "audio", name: label(fr, "Audio", "Audio") },
    { key: "image", name: label(fr, "Images", "Images") },
    { key: "file", name: label(fr, "Other files", "Autres fichiers") },
  ]
    .map((group) => ({
      ...group,
      documents: courseDocuments.filter(
        (document) => courseFileKind(document.mimeType) === group.key,
      ),
    }))
    .filter((group) => group.documents.length);
  const recentlyUploadedDocument = uploadedDocumentId
    ? courseDocuments.find((document) => document.id === uploadedDocumentId) ?? null
    : null;
  const refresh = () => {
    void client.invalidateQueries({
      queryKey: ["professional-course-builder", orgSlug, courseRef.courseId],
    });
    void client.invalidateQueries({ queryKey: ["training-courses", orgSlug] });
  };
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      post<{ course: { courseId: string; versionId: string } }>(
        orgUrl(orgSlug, "professional-training-courses"),
        body,
      ),
    onSuccess: (result) => {
      setCourseRef({
        courseId: result.course.courseId,
        versionId: result.course.versionId,
      });
      refresh();
    },
  });
  const addModule = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      post(
        orgUrl(orgSlug, `training-courses/${courseRef.courseId}/modules`),
        body,
      ),
    onSuccess: refresh,
  });
  const addLesson = useMutation({
    mutationFn: ({
      moduleId,
      body,
    }: {
      moduleId: string;
      body: Record<string, unknown>;
    }) => post(orgUrl(orgSlug, `training-modules/${moduleId}/lessons`), body),
    onSuccess: refresh,
  });
  const addBlock = useMutation({
    mutationFn: ({
      lessonId,
      body,
    }: {
      lessonId: string;
      body: Record<string, unknown>;
    }) => post(orgUrl(orgSlug, `training-lessons/${lessonId}/blocks`), body),
    onSuccess: () => {
      setUploadedDocumentId(null);
      refresh();
    },
  });
  const updateBlock = useMutation({
    mutationFn: ({
      blockId,
      body,
    }: {
      blockId: string;
      body: Record<string, unknown>;
    }) => patch(orgUrl(orgSlug, `training-blocks/${blockId}`), body),
    onSuccess: () => {
      setUploadedDocumentId(null);
      setEditingBlockId(null);
      refresh();
    },
  });
  const deleteBlock = useMutation({
    mutationFn: (blockId: string) =>
      del(orgUrl(orgSlug, `training-blocks/${blockId}`)),
    onSuccess: () => {
      setEditingBlockId(null);
      refresh();
    },
  });  const aiDraft = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      post<{
        draft: unknown;
        usage: { used: number; limit: number };
        reviewRequired: boolean;
      }>(orgUrl(orgSlug, "training-ai"), body),
    onSuccess: (result) => {
      setAiOutlineDraft(
        result.draft && typeof result.draft === "object" && !Array.isArray(result.draft)
          ? (result.draft as Record<string, unknown>)
          : null,
      );
      setAiImportMessage(null);
      setReplaceAiOutline(false);
      setAiDraftText(
        typeof result.draft === "string"
          ? result.draft
          : JSON.stringify(result.draft, null, 2),
      );
    },
  });
  const importAiOutline = useMutation({
    mutationFn: (body: {
      versionId: string;
      draft: Record<string, unknown>;
      replaceExisting: boolean;
      applyCourseDetails: boolean;
    }) =>
      post<{ imported: boolean; duplicate: boolean; modules: number; lessons: number; acknowledgments: number }>(
        orgUrl(orgSlug, `training-courses/${courseRef.courseId}/ai-outline`),
        body,
      ),
    onSuccess: (result) => {
      setAiImportMessage(
        result.duplicate
          ? label(fr, "This AI plan is already in this draft.", "Ce plan IA est déjà présent dans ce brouillon.")
          : label(
              fr,
              `${result.modules} module(s), ${result.lessons} lesson(s) and ${result.acknowledgments} acknowledgment(s) were added to the draft. Review their content before publishing.`,
              `${result.modules} module(s), ${result.lessons} leçon(s) et ${result.acknowledgments} attestation(s) ont été ajoutés au brouillon. Vérifiez leur contenu avant publication.`,
            ),
      );
      refresh();
    },
  });
  const publish = useMutation({
    mutationFn: () =>
      post(
        orgUrl(
          orgSlug,
          `training-courses/${courseRef.courseId}/versions/${versionId}/publish`,
        ),
        { requiresRetake: false },
      ),
    onSuccess: () => {
      refresh();
      void client.invalidateQueries({
        queryKey: ["training-summary", orgSlug],
      });
    },
  });
  const createRevision = useMutation({
    mutationFn: () =>
      post<{ revision: { versionId: string } }>(
        orgUrl(orgSlug, `training-courses/${courseRef.courseId}/revisions`),
      ),
    onSuccess: (result) => {
      setCourseRef({
        courseId: courseRef.courseId,
        versionId: result.revision.versionId,
      });
      setEditingBlockId(null);
      setSelectedModuleId(null);
      setSelectedLessonId(null);
      refresh();
    },
  });
  const questionBanks = useQuery({
    queryKey: ["training-question-banks", orgSlug],
    queryFn: () =>
      get<{ questionBanks: QuestionBank[] }>(
        orgUrl(orgSlug, "training-question-banks"),
      ),
    enabled: Boolean(courseRef.courseId),
  });  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.set("file", file);
      form.set("title", file.name.replace(/\.[^.]+$/, ""));
      form.set("category", "general");
      const response = await api.post<{ document: { id: string } }>(
        orgUrl(orgSlug, "documents"),
        form,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      return response.data.document;
    },
    onSuccess: (document) => {
      setUploadedDocumentId(document.id);
      void client.invalidateQueries({
        queryKey: ["professional-course-documents", orgSlug],
      });
    },
  });
  // The server confirms the current course version. Prefer it over any stale dialog reference before a module, lesson or publish request is made.
  const versionId = builder.data?.activeVersionId ?? courseRef.versionId;
  const builderReady = Boolean(builder.data && versionId);
  const versionStatus = builder.data?.versions?.find(
    (item: any) => item.id === versionId,
  )?.status;
  const isDraftVersion = builderReady && versionStatus === "draft";
  const canEditOutline = Boolean(builderReady && isDraftVersion);
  const canImportAiOutline = Boolean(
    aiOutlineDraft &&
      Array.isArray(aiOutlineDraft.modules) &&
      aiOutlineDraft.modules.length &&
      canEditOutline &&
      versionId,
  );
  useEffect(() => {
    if (!builderReady) return;
    // A submit attempted before the version finished loading must not leave a
    // stale validation message once the real draft/published version arrives.
    addModule.reset();
    addLesson.reset();
    addBlock.reset();
    updateBlock.reset();
    deleteBlock.reset();
    setContentError(null);
  }, [
    builderReady,
    courseRef.courseId,
    courseRef.versionId,
    addModule.reset,
    addLesson.reset,
    addBlock.reset,
    updateBlock.reset,
    deleteBlock.reset,
  ]);
  const modules = builder.data?.modules ?? [];
  const totalLessonCount = modules.reduce(
    (total: number, module: any) => total + (module.lessons?.length ?? 0),
    0,
  );
  const selectedModule =
    modules.find((module: any) => module.id === selectedModuleId) ?? modules[0];
  const selectedLesson =
    selectedModule?.lessons?.find(
      (lesson: any) => lesson.id === selectedLessonId,
    ) ?? selectedModule?.lessons?.[0];  const editingBlock =
    selectedLesson?.blocks?.find((block: any) => block.id === editingBlockId) ??
    null;
  const editorContent = (block: any) => {
    if (!block) return "";
    const content = block.content ?? {};
    if (block.block_type === "checklist" || block.block_type === "procedure")
      return Array.isArray(content.items)
        ? content.items.map((item: any) => String(item.label ?? "")).join("\n")
        : "";
    if (block.block_type === "quiz") return JSON.stringify(content, null, 2);
    return String(content.body ?? content.text ?? content.description ?? "");
  };
  const error =
    apiError(builder.error) ??
    apiError(documents.error) ??
    apiError(questionBanks.error) ??
    apiError(create.error) ??
    apiError(addModule.error) ??
    apiError(addLesson.error) ??
    apiError(addBlock.error) ??
    apiError(updateBlock.error) ??
    apiError(deleteBlock.error) ??
    apiError(createRevision.error) ??
    apiError(publish.error) ??
    apiError(upload.error) ??
    apiError(aiDraft.error) ??
    apiError(importAiOutline.error) ??
    contentError;
  const steps = [
    label(fr, "Information", "Informations"),
    label(fr, "Audience", "Public et affectation"),
    label(fr, "Modules", "Modules et leçons"),
    label(fr, "Assessment", "Évaluation"),
    label(fr, "Completion", "Conditions de réussite"),
    label(fr, "Certificate", "Certificat"),
    label(fr, "Preview", "Aperçu"),
    label(fr, "Publish", "Publication"),
  ];
  const activeStep = !courseRef.courseId
    ? 1
    : modules.length === 0
      ? 3
      : selectedLesson
        ? 4
        : 3;
  return (
    <Dialog
      wide
      title={label(
        fr,
        "Professional course builder",
        "Constructeur de cours professionnel",
      )}
      onClose={onClose}
    >
      <section className="mb-6 overflow-hidden rounded-2xl border border-border bg-surface-2 p-3 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3 px-1">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-brand">
              {label(fr, "Course workflow", "Parcours de création")}
            </p>
            <p className="mt-1 text-xs text-ink-secondary">
              {label(fr, "Complete the foundation first, then build and publish with confidence.", "Créez d’abord la fondation, puis construisez et publiez le cours en toute confiance.")}
            </p>
          </div>
          <Badge variant="outline">{label(fr, `Step ${activeStep} of 8`, `Étape ${activeStep} sur 8`)}</Badge>
        </div>
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
          {steps.map((step, index) => {
            const number = index + 1;
            const current = number === activeStep;
            const complete = number < activeStep;
            return (
              <li key={step} className={`min-w-0 rounded-xl border px-2.5 py-2.5 transition ${current ? "border-brand bg-brand text-white shadow-sm" : complete ? "border-good/30 bg-good/10 text-good-ink" : "border-border bg-surface-1 text-ink-muted"}`}>
                <span className={`inline-grid size-5 place-items-center rounded-full text-[10px] font-bold ${current ? "bg-white/20 text-white" : complete ? "bg-good text-white" : "bg-surface-3 text-ink-secondary"}`}>{complete ? "✓" : number}</span>
                <span className="mt-2 block truncate text-[11px] font-semibold leading-4">{step}</span>
              </li>
            );
          })}
        </ol>
      </section>
      {error ? (
        <p className="mb-4 rounded-xl border border-critical/25 bg-critical/10 p-3 text-sm text-critical">
          {error}
        </p>
      ) : null}
      {!courseRef.courseId ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const name = String(form.get("name") ?? "").trim();
            const rawCode = String(form.get("code") ?? "").trim();
            create.mutate({
              code: trainingCode(rawCode || name),
              name,
              summary: String(form.get("summary") ?? "").trim() || null,
              description: String(form.get("description") ?? "").trim() || null,
              category: String(form.get("category") ?? "general"),
              learningObjectives: String(form.get("objectives") ?? "")
                .split(/\r?\n/)
                .map((value) => value.trim())
                .filter(Boolean),
              estimatedDurationMinutes: String(
                form.get("duration") ?? "",
              ).trim()
                ? Number(form.get("duration"))
                : null,
              difficulty: String(form.get("difficulty") ?? "foundation"),
              languages: [
                "fr",
                ...(form.get("english") === "on" ? ["en"] : []),
              ],
              isMandatory: form.get("mandatory") === "on",
              validityMonths: String(form.get("validity") ?? "").trim()
                ? Number(form.get("validity"))
                : null,
              tags: String(form.get("tags") ?? "")
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
              renewalMonths: String(form.get("renewalMonths") ?? "").trim()
                ? Number(form.get("renewalMonths"))
                : null,
              renewalRequired: form.get("renewalRequired") === "on",
              autoAssignNewEmployees: form.get("autoAssignNewEmployees") === "on",
              defaultDueDays: String(form.get("defaultDueDays") ?? "").trim()
                ? Number(form.get("defaultDueDays"))
                : null,
              completionMode:
                form.get("completionMode") === "automatic"
                  ? "automatic"
                  : "manager_validation",
            });
          }}
        >
          <Field label={label(fr, "Course title", "Titre du cours")} required>
            <Input
              name="name"
              required
              placeholder={label(
                fr,
                "Example: Congo Omega induction",
                "Exemple : Accueil Congo Omega",
              )}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={label(fr, "Course code", "Code du cours")}
              hint={label(
                fr,
                "Generated safely from the title when blank.",
                "Généré depuis le titre s’il est vide.",
              )}
            >
              <Input name="code" placeholder="accueil_congo_omega" />
            </Field>
            <Field label={label(fr, "Category", "Catégorie")} required>
              <select
                className={selectClass}
                name="category"
                defaultValue="induction"
              >
                <option value="general">General</option>
                <option value="induction">Induction</option>
                <option value="safety">Safety</option>
                <option value="biosecurity">Biosecurity</option>
                <option value="technical">Technical</option>
                <option value="compliance">Compliance</option>
                <option value="management">Management</option>
              </select>
            </Field>
          </div>
          <Field label={label(fr, "Short summary", "Résumé court")}>
            <Textarea name="summary" rows={2} />
          </Field>
          <Field label={label(fr, "Full description", "Description complète")}>
            <Textarea name="description" rows={4} />
          </Field>
          <Field
            label={label(fr, "Learning objectives", "Objectifs pédagogiques")}
            hint={label(
              fr,
              "One objective per line.",
              "Un objectif par ligne.",
            )}
          >
            <Textarea name="objectives" rows={3} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label={label(
                fr,
                "Estimated duration (minutes)",
                "Durée estimée (minutes)",
              )}
            >
              <Input name="duration" type="number" min="1" />
            </Field>
            <Field label={label(fr, "Difficulty", "Niveau")}>
              <select className={selectClass} name="difficulty">
                <option value="foundation">Foundation</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </Field>
            <Field label={label(fr, "Validity (months)", "Validité (mois)")}>
              <Input name="validity" type="number" min="1" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={label(fr, "Renewal interval (months)", "Renouvellement (mois)")} hint={label(fr, "Leave blank when no renewal is needed.", "Laissez vide si aucun renouvellement n’est requis.")}>
              <Input name="renewalMonths" type="number" min="1" />
            </Field>
            <Field label={label(fr, "Default deadline (days)", "Échéance par défaut (jours)")}>
              <Input name="defaultDueDays" type="number" min="1" />
            </Field>
            <Field label={label(fr, "Tags", "Étiquettes")} hint={label(fr, "Separate with commas.", "Séparez par des virgules.")}>
              <Input name="tags" placeholder="safety, induction" />
            </Field>
          </div>
          <div className="grid gap-3 rounded-xl border border-border bg-surface-2 p-4 text-sm text-ink">
            <label className="flex items-center gap-2">
              <input name="renewalRequired" type="checkbox" />
              {label(fr, "Require renewal before expiry", "Exiger le renouvellement avant expiration")}
            </label>
            <label className="flex items-center gap-2">
              <input name="autoAssignNewEmployees" type="checkbox" />
              {label(fr, "Assign automatically to new employees", "Affecter automatiquement aux nouveaux employés")}
            </label>
            <label className="flex items-center gap-2">
              <input name="mandatory" type="checkbox" />
              {label(fr, "Mandatory course", "Formation obligatoire")}
            </label>
            <label className="flex items-center gap-2">
              <input name="english" type="checkbox" />
              {label(
                fr,
                "Also available in English",
                "Également disponible en anglais",
              )}
            </label>
            <label className="flex items-center gap-2">
              <input name="completionMode" type="radio" value="automatic" />
              {label(
                fr,
                "Automatic completion after requirements",
                "Complétion automatique après les exigences",
              )}
            </label>
            <label className="flex items-center gap-2">
              <input
                name="completionMode"
                type="radio"
                value="manager_validation"
                defaultChecked
              />
              {label(
                fr,
                "Require manager validation",
                "Exiger la validation du responsable",
              )}
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {label(fr, "Cancel", "Annuler")}
            </Button>
            <Button type="submit" loading={create.isPending}>
              <ChevronRight className="size-4" />
              {label(fr, "Create course", "Créer le cours")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-5">
          <section className="relative overflow-hidden rounded-2xl border border-indigo-400/20 bg-[radial-gradient(circle_at_88%_15%,rgba(99,102,241,.22),transparent_30%),linear-gradient(135deg,rgba(67,56,202,.12),rgba(59,130,246,.055))] p-5">
            <div className="relative flex flex-wrap items-start justify-between gap-4">
              <div>
                <Badge variant={!builderReady ? "outline" : isDraftVersion ? "info" : "warning"}>
                  {!builderReady
                    ? label(fr, "Loading version", "Chargement de la version")
                    : isDraftVersion
                      ? label(fr, "Draft version", "Version brouillon")
                      : label(fr, "Published version", "Version publiée")}
                </Badge>
                <h3 className="mt-3 text-xl font-semibold tracking-tight text-ink">
                  {builder.data?.course?.name ?? label(fr, "Loading course…", "Chargement du cours…")}
                </h3>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-secondary">
                  {label(fr, "Build the learning flow, then publish when it is ready to assign.", "Construisez le parcours, vérifiez les exigences, puis publiez lorsqu’il est prêt à être affecté.")}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl border border-white/40 bg-white/45 px-4 py-3 dark:bg-white/5"><p className="text-xs text-ink-muted">{label(fr,"Modules","Modules")}</p><p className="mt-1 text-lg font-semibold text-ink">{modules.length}</p></div>
                <div className="rounded-xl border border-white/40 bg-white/45 px-4 py-3 dark:bg-white/5"><p className="text-xs text-ink-muted">{label(fr,"Lessons","Leçons")}</p><p className="mt-1 text-lg font-semibold text-ink">{totalLessonCount}</p></div>
              </div>
            </div>
          </section>
          <details
            className="rounded-2xl border border-brand/20 bg-gradient-to-br from-brand/[.055] to-transparent p-4 shadow-sm"
            open={aiAssistantOpen}
            onToggle={(event) => setAiAssistantOpen(event.currentTarget.open)}
          >
            <summary className="flex cursor-pointer list-none items-start justify-between gap-3 rounded-xl text-left marker:hidden">
              <span className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand text-white">
                <Sparkles className="size-4" />
              </span>
              <span className="min-w-0">
                <h3 className="font-semibold text-ink">
                  {label(
                    fr,
                    "AI drafting assistant",
                    "Assistant IA de brouillon",
                  )}
                </h3>
                <p className="mt-1 text-xs leading-5 text-ink-secondary">
                  {label(
                    fr,
                    "Paste only the policy or course excerpt you approve for AI drafting. The result stays a draft and is never published automatically.",
                    "Collez uniquement le règlement ou l’extrait de cours autorisé. Le résultat reste un brouillon et n’est jamais publié automatiquement.",
                  )}
                </p>
              </span>
              </span>
              <ChevronRight className={`mt-2 size-5 shrink-0 text-brand transition-transform ${aiAssistantOpen ? "rotate-90" : ""}`} />
            </summary>
            {aiAssistantOpen ? (
              <div className="mt-4 border-t border-brand/15 pt-4">
                <form
                  className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                aiDraft.mutate({
                  action: String(form.get("action") ?? "course_outline"),
                  sourceText: String(form.get("sourceText") ?? "").trim(),
                  courseTitle: builder.data?.course?.name ?? null,
                  targetLanguage: fr ? "fr" : "en",
                  audience: String(form.get("audience") ?? "").trim() || null,
                });
              }}
            >
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <Field label={label(fr, "Draft action", "Action de brouillon")}>
                  <select
                    className={selectClass}
                    name="action"
                    defaultValue="course_outline"
                  >
                    <option value="course_outline">
                      {label(fr, "Course outline", "Plan de cours")}
                    </option>
                    <option value="objectives">
                      {label(
                        fr,
                        "Learning objectives",
                        "Objectifs pédagogiques",
                      )}
                    </option>
                    <option value="policy_to_lessons">
                      {label(fr, "Policy to lessons", "Règlement vers leçons")}
                    </option>
                    <option value="quiz_questions">
                      {label(
                        fr,
                        "Draft quiz questions",
                        "Brouillon de questions",
                      )}
                    </option>
                    <option value="simplify">
                      {label(fr, "Simplify language", "Simplifier le langage")}
                    </option>
                    <option value="translate">
                      {label(fr, "Translate", "Traduire")}
                    </option>
                    <option value="quiz_source_check">
                      {label(
                        fr,
                        "Check quiz sources",
                        "Vérifier les sources du quiz",
                      )}
                    </option>
                  </select>
                </Field>
                <Field label={label(fr, "Audience", "Public")}>
                  <Input
                    name="audience"
                    placeholder={label(
                      fr,
                      "Example: new farm employees",
                      "Exemple : nouveaux employés de ferme",
                    )}
                  />
                </Field>
              </div>
              <Field
                label={label(
                  fr,
                  "Approved source text",
                  "Texte source autorisé",
                )}
                required
              >
                <Textarea name="sourceText" required rows={6} />
              </Field>
              <Button type="submit" loading={aiDraft.isPending}>
                <Sparkles className="size-4" />
                {label(fr, "Generate review draft", "Générer le brouillon")}
              </Button>
            </form>
            {aiDraftText ? (
              <div className="mt-4 space-y-3">
                {canImportAiOutline ? (
                  <div className="rounded-xl border border-good/25 bg-good/5 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-ink">
                          {label(fr, "Course plan ready to add", "Plan de cours prêt à être ajouté")}
                        </p>
                        <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-secondary">
                          {label(fr, "Add the proposed modules, lessons and required acknowledgments to this editable draft. The AI never publishes the course.", "Ajoutez les modules, leçons et attestations proposés à ce brouillon modifiable. L’IA ne publie jamais le cours.")}
                        </p>
                      </div>
                      <Badge variant="outline">
                        {Array.isArray(aiOutlineDraft?.modules) ? aiOutlineDraft.modules.length : 0} {label(fr, "modules", "modules")}
                      </Badge>
                    </div>
                    <label className="mt-3 flex items-start gap-2 text-xs leading-5 text-ink-secondary">
                      <input
                        type="checkbox"
                        checked={replaceAiOutline}
                        onChange={(event) => setReplaceAiOutline(event.target.checked)}
                      />
                      {label(fr, "Replace the modules and lessons already in this draft", "Remplacer les modules et leçons déjà présents dans ce brouillon")}
                    </label>
                    <Button
                      className="mt-3"
                      type="button"
                      loading={importAiOutline.isPending}
                      onClick={() => {
                        if (!versionId || !aiOutlineDraft) return;
                        if (
                          replaceAiOutline &&
                          !window.confirm(
                            label(
                              fr,
                              "Replace every module, lesson and content block in this draft with this AI plan? This cannot affect published learner versions.",
                              "Remplacer tous les modules, leçons et blocs de ce brouillon par ce plan IA ? Les versions publiées des apprenants ne seront jamais modifiées.",
                            ),
                          )
                        ) return;
                        importAiOutline.mutate({
                          versionId,
                          draft: aiOutlineDraft,
                          replaceExisting: replaceAiOutline,
                          applyCourseDetails: true,
                        });
                      }}
                    >
                      <Plus className="size-4" />
                      {label(fr, "Add plan to draft", "Ajouter le plan au brouillon")}
                    </Button>
                  </div>
                ) : (
                  <p className="rounded-xl border border-warning/25 bg-warning/10 p-3 text-xs leading-5 text-ink-secondary">
                    {label(fr, "This AI response is a suggestion only. Generate a course outline or policy-to-lessons draft to import modules and lessons.", "Cette réponse IA est une suggestion. Générez un plan de cours ou un règlement vers leçons pour importer les modules et les leçons.")}
                  </p>
                )}
                {aiImportMessage ? (
                  <p className="rounded-xl border border-good/25 bg-good/10 p-3 text-xs leading-5 text-good">{aiImportMessage}</p>
                ) : null}
                <details className="rounded-xl border border-border bg-surface-1">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-ink-secondary">
                    {label(fr, "View raw AI draft (JSON)", "Voir le brouillon IA brut (JSON)")}
                  </summary>
                  <pre className="max-h-72 overflow-auto border-t border-border p-3 text-xs leading-5 text-ink">{aiDraftText}</pre>
                </details>
              </div>
            ) : null}
              </div>
            ) : (
              <p className="mt-3 border-t border-brand/15 pt-3 text-xs leading-5 text-ink-secondary">
                {label(
                  fr,
                  "Optional: use AI to create a reviewable draft outline, objectives or quiz questions.",
                  "Optionnel : utilisez l’IA pour créer un brouillon vérifiable de plan, d’objectifs ou de questions.",
                )}
              </p>
            )}
          </details>
          <section className="grid gap-5 xl:grid-cols-[minmax(19rem,.78fr)_minmax(0,1.22fr)] xl:items-start">
          <section className="rounded-2xl border border-border bg-surface-1 p-4 shadow-sm xl:sticky xl:top-4 xl:max-h-[calc(100vh-10rem)] xl:overflow-y-auto">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-ink">
                  {label(fr, "Modules and lessons", "Modules et leçons")}
                </h3>
                <p className="mt-1 text-xs text-ink-secondary">
                  {label(
                    fr,
                    "Use the order fields to define the learner path. Required lessons can be sequential.",
                    "Utilisez les numéros d’ordre pour définir le parcours. Les leçons requises peuvent être séquentielles.",
                  )}
                </p>
              </div>
            </div>
            {!builderReady ? (
              <p className="mt-4 rounded-xl border border-brand/20 bg-brand/[.06] px-3 py-2 text-xs leading-5 text-ink-secondary">
                {label(
                  fr,
                  "Loading the course version. Module, lesson and content actions become available as soon as it is ready.",
                  "Chargement de la version du cours. Les actions sur les modules, leçons et contenus seront disponibles dès qu’elle sera prête.",
                )}
              </p>
            ) : null}
            <div className="mt-4 rounded-xl border border-brand/15 bg-brand/[.035] p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand">
                {label(fr, "Add a module", "Ajouter un module")}
              </p>
            <form
              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                if (!canEditOutline || !versionId) {
                  setContentError(
                    label(
                      fr,
                      "Wait for the course version to finish loading, or create a draft revision before editing.",
                      "Attendez le chargement complet de la version du cours, ou créez une révision brouillon avant toute modification.",
                    ),
                  );
                  return;
                }
                const form = new FormData(event.currentTarget);
                const title = String(form.get("title") ?? "").trim();
                addModule.mutate({
                  versionId,
                  title,
                  code: trainingCode(String(form.get("code") ?? "") || title),
                  sortOrder: Number(
                    form.get("sortOrder") || modules.length + 1,
                  ),
                  isRequired: true,
                });
                event.currentTarget.reset();
              }}
            >
              <Input
                name="title"
                required
                placeholder={label(fr, "Module title", "Titre du module")}
              />
              <Input
                name="sortOrder"
                type="number"
                min="0"
                defaultValue={modules.length + 1}
              />
              <Input className="hidden" name="code" />
              <Button type="submit" size="sm" disabled={!canEditOutline} loading={addModule.isPending}>
                <Plus className="size-4" />
                {label(fr, "Add module", "Ajouter")}
              </Button>
            </form>
            </div>
            <div className="mt-4 space-y-3">
              {modules.length ? modules.map((module: any, moduleIndex: number) => (
                <div
                  key={module.id}
                  className={`rounded-2xl border p-3 transition ${selectedModule?.id === module.id ? "border-brand/35 bg-gradient-to-br from-brand/[.09] to-transparent shadow-sm" : "border-border bg-surface-1 hover:border-brand/25"}`}
                >
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => {
                      setSelectedModuleId(module.id);
                      setSelectedLessonId(module.lessons?.[0]?.id ?? null);
                    }}
                  >
                    <p className="flex items-center gap-2 font-semibold text-ink">
                      <span className="grid size-6 place-items-center rounded-lg bg-brand/10 text-xs font-bold text-brand">
                        {module.sort_order || moduleIndex + 1}
                      </span>
                      <span className="truncate">{module.title}</span>
                    </p>
                    <p className="mt-1 text-xs text-ink-secondary">
                      {module.lessons?.length ?? 0}{" "}
                      {label(fr, "lesson(s)", "leçon(s)")}
                    </p>
                  </button>
                  <div className="mt-3 space-y-2">
                    {module.lessons?.map((lesson: any, lessonIndex: number) => (
                      <button
                        key={lesson.id}
                        type="button"
                        onClick={() => {
                          setSelectedModuleId(module.id);
                          setSelectedLessonId(lesson.id);
                        }}
                        className={`flex w-full items-center gap-2 rounded-xl border px-2.5 py-2.5 text-left text-sm transition ${selectedLesson?.id === lesson.id ? "border-brand/25 bg-brand/10 text-brand" : "border-transparent text-ink-secondary hover:border-border hover:bg-surface-2"}`}
                      >
                        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-3 text-[10px] font-semibold text-ink-muted">
                          {lessonIndex + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{lesson.title}</span>
                        <span className="shrink-0 text-[11px] text-ink-muted">
                          {lesson.blocks?.length ?? 0} {label(fr, "blocks", "blocs")}
                        </span>
                      </button>
                    ))}
                  </div>
                  {selectedModule?.id === module.id ? (
                    <>
                    <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      {label(fr, "Add a lesson to this module", "Ajouter une leçon à ce module")}
                    </p>
                    <form
                      className="mt-2 grid gap-2 rounded-xl border border-border bg-surface-1 p-2 sm:grid-cols-[minmax(0,1fr)_5.5rem_auto]"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!canEditOutline || !versionId) {
                          setContentError(
                            label(
                              fr,
                              "Wait for the course version to finish loading, or create a draft revision before editing.",
                              "Attendez le chargement complet de la version du cours, ou créez une révision brouillon avant toute modification.",
                            ),
                          );
                          return;
                        }
                        const form = new FormData(event.currentTarget);
                        const title = String(form.get("title") ?? "").trim();
                        addLesson.mutate({
                          moduleId: module.id,
                          body: {
                            versionId,
                            title,
                            code: trainingCode(
                              String(form.get("code") ?? "") || title,
                            ),
                            sortOrder: Number(
                              form.get("sortOrder") ||
                                module.lessons.length + 1,
                            ),
                            isRequired: true,
                            requireSequential: form.get("sequential") === "on",
                            completionMode: "learner_confirmation",
                          },
                        });
                        event.currentTarget.reset();
                      }}
                    >
                      <Input
                        name="title"
                        required
                        placeholder={label(
                          fr,
                          "Lesson title",
                          "Titre de la leçon",
                        )}
                      />
                      <Input
                        name="sortOrder"
                        type="number"
                        min="0"
                        defaultValue={(module.lessons?.length ?? 0) + 1}
                      />
                      <Button
                        type="submit"
                        size="sm"
                        disabled={!canEditOutline}
                        loading={addLesson.isPending}
                      >
                        {label(fr, "Add lesson", "Ajouter")}
                      </Button>
                      <Input className="hidden" name="code" />
                    </form>
                    </>
                  ) : null}
                </div>
              )) : (
                <div className="rounded-2xl border border-dashed border-brand/35 bg-brand/[.035] px-5 py-7 text-center">
                  <span className="mx-auto grid size-11 place-items-center rounded-2xl bg-brand/10 text-brand">
                    <LibraryBig className="size-5" />
                  </span>
                  <h4 className="mt-3 text-sm font-semibold text-ink">{label(fr, "Start with the first module", "Commencez par le premier module")}</h4>
                  <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-ink-secondary">{label(fr, "A module groups related lessons. Give it a clear title, then add the first lesson.", "Un module regroupe des leçons liées. Donnez-lui un titre clair, puis ajoutez la première leçon.")}</p>
                </div>
              )}
            </div>
          </section>
          {selectedLesson ? (
            <section className="rounded-2xl border border-border bg-surface-1 p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[.14em] text-brand">
                    {selectedModule?.title ?? label(fr, "Course lesson", "Leçon du parcours")}
                  </p>
                  <h3 className="mt-1 text-xl font-semibold tracking-tight text-ink">
                    {selectedLesson.title}
                  </h3>
                  <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-secondary">
                    {label(
                      fr,
                      "Build this lesson with clear, ordered learning content.",
                      "Construisez cette leçon avec un contenu clair et ordonné.",
                    )}
                  </p>
                </div>
                <Badge variant="outline">
                  {selectedLesson.blocks?.length ?? 0} {label(fr, "blocks", "blocs")}
                </Badge>
              </div>
              {!isDraftVersion ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/10 p-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {label(fr, "This course version is published", "Cette version du cours est publiée")}
                    </p>
                    <p className="mt-0.5 max-w-xl text-xs leading-5 text-ink-secondary">
                      {label(fr, "Create a draft revision before changing lessons. Existing learners keep their published version.", "Créez une révision brouillon avant de modifier les leçons. Les apprenants actuels conservent leur version publiée.")}
                    </p>
                  </div>
                  <Button type="button" size="sm" variant="secondary" loading={createRevision.isPending} onClick={() => createRevision.mutate()}>
                    <FileText className="size-4" />
                    {label(fr, "Create draft revision", "Créer une révision brouillon")}
                  </Button>
                </div>
              ) : null}              <div className="mt-5">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  {label(fr, "Lesson flow", "Parcours de la leçon")}
                </p>
                <div className="space-y-2">
                  {selectedLesson.blocks?.length ? selectedLesson.blocks.map((block: any, blockIndex: number) => (
                    <div
                      key={block.id}
                      className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/70 px-3 py-2.5 text-sm"
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand/10 text-xs font-bold text-brand">
                        {blockIndex + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">
                          {block.title || label(fr, "Untitled block", "Bloc sans titre")}
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-muted">
                          {block.block_type}
                        </span>
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge variant="outline">#{block.sort_order}</Badge>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          loading={!isDraftVersion && createRevision.isPending}
                          onClick={() => {
                            if (!isDraftVersion) {
                              createRevision.mutate();
                              return;
                            }
                            setEditingBlockId(block.id);
                          }}
                        >
                          {isDraftVersion
                            ? label(fr, "Edit", "Modifier")
                            : label(fr, "Create revision", "Créer la révision")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          loading={(!isDraftVersion && createRevision.isPending) || (deleteBlock.isPending && deleteBlock.variables === block.id)}
                          onClick={() => {
                            if (!isDraftVersion) {
                              createRevision.mutate();
                              return;
                            }
                            if (
                              window.confirm(
                                label(
                                  fr,
                                  "Delete this content block? This only changes the current draft version.",
                                  "Supprimer ce bloc de contenu ? Cette action ne modifie que la version brouillon actuelle.",
                                ),
                              )
                            )
                              deleteBlock.mutate(block.id);
                          }}
                        >
                          {isDraftVersion
                            ? label(fr, "Delete", "Supprimer")
                            : label(fr, "Create revision", "Créer la révision")}
                        </Button>
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-xl border border-dashed border-border bg-surface-2/50 p-3 text-sm text-ink-secondary">
                      {label(fr, "No content in this lesson yet. Add the first block below.", "Cette leçon ne contient pas encore de contenu. Ajoutez le premier bloc ci-dessous.")}
                    </div>
                  )}
                </div>
              </div>
              {editingBlock ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand/25 bg-brand/10 p-3">
                  <div>
                    <p className="text-sm font-semibold text-brand">
                      {label(fr, "Editing content block", "Modification du bloc de contenu")}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-secondary">
                      {editingBlock.title || label(fr, "Untitled block", "Bloc sans titre")}
                    </p>
                  </div>
                  <Button type="button" size="sm" variant="secondary" onClick={() => setEditingBlockId(null)}>
                    {label(fr, "Cancel edit", "Annuler la modification")}
                  </Button>
                </div>
              ) : null}              <form
                key={editingBlock?.id ?? "new-block"}
                className="mt-5 space-y-4 rounded-2xl border border-brand/15 bg-brand/[.025] p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!canEditOutline || !versionId) {
                    setContentError(
                      label(
                        fr,
                        "Wait for the course version to finish loading, or create a draft revision before editing.",
                        "Attendez le chargement complet de la version du cours, ou créez une révision brouillon avant toute modification.",
                      ),
                    );
                    return;
                  }
                  const form = new FormData(event.currentTarget);
                  const type = String(form.get("blockType") ?? "text");
                  const raw = String(form.get("content") ?? "").trim();
                  let content: Record<string, unknown> = { body: raw };
                  try {
                    if (type === "checklist" || type === "procedure")
                      content = {
                        items: raw
                          .split(/\r?\n/)
                          .map((value, index) => ({
                            id: `item_${index + 1}`,
                            label: value.trim(),
                            required: true,
                          }))
                          .filter((item) => item.label),
                      };
                    if (type === "quiz") {
                      const questionBankId = String(
                        form.get("questionBankId") ?? "",
                      ).trim();
                      content = questionBankId
                        ? {
                            questionBankId,
                            drawCount: Number(form.get("drawCount") || 1),
                            passingScore: Number(form.get("passingScore") || 70),
                          }
                        : {
                            ...JSON.parse(raw),
                            passingScore: Number(form.get("passingScore") || 70),
                          };
                    }
                  } catch {
                    setContentError(
                      label(
                        fr,
                        "Quiz content must be valid JSON.",
                        "Le contenu du quiz doit être un JSON valide.",
                      ),
                    );
                    return;
                  }
                  setContentError(null);
                  const selectedDocumentId = String(
                    form.get("documentId") ?? "",
                  ).trim();
                  const canAttachFile = [
                    "image",
                    "document",
                    "video",
                    "audio",
                    "file",
                  ].includes(type);
                  const body = {
                    blockType: type,
                    title: String(form.get("title") ?? "").trim() || null,
                    content,
                    documentId: canAttachFile
                      ? selectedDocumentId || uploadedDocumentId
                      : null,
                    externalUrl:
                      String(form.get("externalUrl") ?? "").trim() || null,
                    minimumWatchedPercent: Number(
                      form.get("minimumWatchedPercent") || 90,
                    ),
                    allowDownload: form.get("allowDownload") === "on",
                    sortOrder: Number(
                      form.get("sortOrder") ||
                        (selectedLesson.blocks?.length ?? 0) + 1,
                    ),
                    isRequired: form.get("isRequired") === "on",
                  };
                  if (editingBlock) {
                    updateBlock.mutate({ blockId: editingBlock.id, body });
                  } else {
                    addBlock.mutate({ lessonId: selectedLesson.id, body });
                    event.currentTarget.reset();
                  }
                }}
              >
                <div>
                  <p className="text-sm font-semibold text-ink">
                    {label(fr, "Add a learning block", "Ajouter un bloc d’apprentissage")}
                  </p>
                  <p className="mt-1 text-xs text-ink-secondary">
                    {label(fr, "Choose a format, then add only the information this block needs.", "Choisissez un format, puis ajoutez uniquement les informations utiles à ce bloc.")}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label={label(fr, "Content type", "Type de contenu")}
                    required
                  >
                    <select
                      className={selectClass}
                      name="blockType"
                      defaultValue={editingBlock?.block_type ?? "text"}
                    >
                      <option value="text">Rich text</option>
                      <option value="heading">Heading</option>
                      <option value="image">Image</option>
                      <option value="document">Secure PDF/document</option>
                      <option value="video">Video</option>
                      <option value="audio">Audio</option>
                      <option value="file">Downloadable file</option>
                      <option value="link">Secure external link</option>
                      <option value="callout">Callout / warning</option>
                      <option value="checklist">Checklist</option>
                      <option value="procedure">Procedure</option>
                      <option value="acknowledgment">Acknowledgment</option>
                      <option value="reflection">Reflection</option>
                      <option value="quiz">Quiz</option>
                      <option value="supervisor_verification">
                        Supervisor verification
                      </option>
                    </select>
                  </Field>
                  <Field label={label(fr, "Title", "Titre")}>
                    <Input name="title" defaultValue={editingBlock?.title ?? ""} />
                  </Field>
                </div>
                <Field
                  label={label(fr, "Content", "Contenu")}
                  hint={label(
                    fr,
                    "For a checklist, one item per line. For a quiz, enter JSON with questions, options, correctAnswer and passing score.",
                    "Pour une liste, un élément par ligne. Pour un quiz, saisissez le JSON avec questions, options, correctAnswer et note requise.",
                  )}
                >
                  <Textarea name="content" rows={5} defaultValue={editorContent(editingBlock)} />
                </Field>
                <details className="rounded-xl border border-border bg-surface-1/75 p-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-ink marker:hidden">
                    <span>{label(fr, "Advanced block options", "Options avancées du bloc")}</span>
                    <ChevronRight className="size-4 text-brand" />
                  </summary>
                  <p className="mt-1 text-xs leading-5 text-ink-secondary">
                    {label(fr, "Quiz, secure document, media, order and completion settings.", "Quiz, document sécurisé, média, ordre et règles de complétion.")}
                  </p>
                  <div className="mt-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label={label(fr, "Question bank (quiz only)", "Banque de questions (quiz)")}
                    hint={label(fr, "The questions are copied into this course version when the block is saved.", "Les questions sont copiées dans cette version du cours lors de l’enregistrement.")}
                  >
                    <select className={selectClass} name="questionBankId" defaultValue={String(editingBlock?.content?.questionBankId ?? "")}>
                      <option value="">{label(fr, "Use inline quiz content", "Utiliser le quiz saisi")}</option>
                      {(questionBanks.data?.questionBanks ?? []).map((bank) => (
                        <option key={bank.id} value={bank.id}>
                          {bank.name} · {bank.question_count}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={label(fr, "Questions to draw", "Questions à inclure")}>
                    <Input name="drawCount" type="number" min="1" defaultValue={String(editingBlock?.content?.drawCount ?? 1)} />
                  </Field>
                </div>                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label={label(
                      fr,
                      "Existing secure document",
                      "Document sécurisé existant",
                    )}
                  >
                    <select
                      key={`${editingBlock?.id ?? "new-block"}-${uploadedDocumentId ?? "library"}`}
                      className={selectClass}
                      name="documentId"
                      defaultValue={uploadedDocumentId ?? editingBlock?.document_id ?? ""}
                    >
                      <option value="">
                        {label(fr, "No file selected", "Aucun fichier sélectionné")}
                      </option>
                      {courseDocumentGroups.length ? (
                        courseDocumentGroups.map((group) => (
                          <optgroup key={group.key} label={group.name}>
                            {group.documents.map((document) => (
                              <option key={document.id} value={document.id}>
                                {document.title || document.fileName} · {document.fileName} · {document.mimeType}
                              </option>
                            ))}
                          </optgroup>
                        ))
                      ) : (
                        <option value="" disabled>
                          {label(
                            fr,
                            "No company files are available yet",
                            "Aucun fichier de l’entreprise disponible pour le moment",
                          )}
                        </option>
                      )}
                    </select>
                  </Field>
                  <Field label={label(fr, "External URL", "Lien externe")}>
                    <Input
                      name="externalUrl"
                      type="url"
                      defaultValue={editingBlock?.external_url ?? ""}
                      placeholder="https://…"
                    />
                  </Field>
                </div>
                <Field
                  label={label(
                    fr,
                    "Upload a secure course file",
                    "Téléverser un fichier sécurisé de cours",
                  )}
                  hint={label(
                    fr,
                    "Choose Document, Video, Audio, Image or Downloadable file above. After upload, the file is selected automatically and will appear in the lesson after you save this block.",
                    "Choisissez Document, Vidéo, Audio, Image ou Fichier téléchargeable ci-dessus. Après le téléversement, le fichier est sélectionné automatiquement et apparaîtra dans la leçon après l’enregistrement du bloc.",
                  )}
                >
                  <Input
                    type="file"
                    accept="application/pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,image/*,video/mp4,video/webm,audio/*"
                    disabled={upload.isPending}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) upload.mutate(file);
                    }}
                  />
                </Field>
                {upload.isPending ? (
                  <p className="rounded-lg bg-brand/10 px-3 py-2 text-xs font-medium text-brand">
                    {label(fr, "Uploading the secure course file…", "Téléversement sécurisé du fichier de cours…")}
                  </p>
                ) : null}
                {recentlyUploadedDocument ? (
                  <p className="rounded-lg border border-good/25 bg-good/10 px-3 py-2 text-xs font-medium text-good">
                    {label(fr, "Ready to attach", "Prêt à être attaché")} · {recentlyUploadedDocument.title || recentlyUploadedDocument.fileName}
                  </p>
                ) : null}
                <p className="text-xs leading-5 text-ink-secondary">
                  {label(
                    fr,
                    "Only private company-library files are offered here. Project-only and restricted documents stay excluded so employees never receive confidential files by mistake.",
                    "Seuls les fichiers de la bibliothèque privée de l’entreprise sont proposés ici. Les documents limités à un projet ou restreints restent exclus pour ne jamais exposer un fichier confidentiel aux employés.",
                  )}
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label={label(fr, "Order", "Ordre")}>
                    <Input
                      name="sortOrder"
                      type="number"
                      min="0"
                      defaultValue={editingBlock?.sort_order ?? (selectedLesson.blocks?.length ?? 0) + 1}
                    />
                  </Field>
                  <Field
                    label={label(
                      fr,
                      "Video minimum watched %",
                      "Visionnage vidéo minimum %",
                    )}
                  >
                    <Input
                      name="minimumWatchedPercent"
                      type="number"
                      min="1"
                      max="100"
                      defaultValue={String(editingBlock?.minimum_watched_percent ?? 90)}
                    />
                  </Field>
                  <Field label={label(fr, "Passing score", "Note de réussite")}>
                    <Input
                      name="passingScore"
                      type="number"
                      min="0"
                      max="100"
                      defaultValue={String(editingBlock?.content?.passingScore ?? 70)}
                    />
                  </Field>
                </div>
                <div className="flex flex-wrap gap-4 text-sm text-ink">
                  <label className="flex items-center gap-2">
                    <input name="isRequired" type="checkbox" defaultChecked={editingBlock ? Boolean(editingBlock.is_required) : true} />
                    {label(fr, "Required", "Requis")}
                  </label>
                  <label className="flex items-center gap-2">
                    <input name="allowDownload" type="checkbox" defaultChecked={Boolean(editingBlock?.allow_download)} />
                    {label(fr, "Allow download", "Autoriser le téléchargement")}
                  </label>
                </div>
                  </div>
                </details>
                <Button type="submit" disabled={!canEditOutline} loading={addBlock.isPending || updateBlock.isPending}>
                  <Plus className="size-4" />
                  {editingBlock ? label(fr, "Save changes", "Enregistrer les modifications") : label(fr, "Add content block", "Ajouter le bloc")}
                </Button>
              </form>
            </section>
          ) : (
            <EmptyState
              icon={PlayCircle}
              title={label(
                fr,
                "Add a lesson first",
                "Ajoutez d’abord une leçon",
              )}
              description={label(
                fr,
                "Select a module and add the first ordered lesson.",
                "Sélectionnez un module et ajoutez la première leçon ordonnée.",
              )}
            />
          )}
          </section>
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-good/25 bg-good/5 p-4 shadow-sm">
            <div>
              <h3 className="font-semibold text-ink">
                {label(fr, "Review and publish", "Aperçu et publication")}
              </h3>
              <p className="mt-1 text-xs text-ink-secondary">
                {label(
                  fr,
                  "Publishing freezes this version. New assignments receive this published version; existing learners keep their assigned version.",
                  "La publication fige cette version. Les nouvelles affectations la reçoivent ; les apprenants existants gardent leur version.",
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {builderReady && builder.data?.versions?.find(
                (item: any) => item.id === versionId,
              )?.status !== "draft" ? (
                <Button
                  variant="secondary"
                  loading={createRevision.isPending}
                  onClick={() => createRevision.mutate()}
                >
                  <FileText className="size-4" />
                  {label(
                    fr,
                    "Create draft revision",
                    "Créer une révision brouillon",
                  )}
                </Button>
              ) : (
                <Button
                  loading={publish.isPending}
                  disabled={
                    !modules.some((module: any) => module.lessons?.length)
                  }
                  onClick={() => publish.mutate()}
                >
                  <ShieldCheck className="size-4" />
                  {label(fr, "Publish course", "Publier le cours")}
                </Button>
              )}
            </div>
          </section>
          <div className="flex justify-end">
            <Button type="button" variant="secondary" onClick={onClose}>
              {label(fr, "Close", "Fermer")}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
function Field({
  label: fieldLabel,
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
    `training-${fieldLabel
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}`;
  return (
    <BaseField label={fieldLabel} htmlFor={id} {...props}>
      {children}
    </BaseField>
  );
}
function Metric({
  icon: Icon,
  title,
  value,
  text,
  tone = "neutral",
}: {
  icon: typeof LibraryBig;
  title: string;
  value: number;
  text: string;
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
    <article className="group relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-surface-1 via-surface-1 to-brand-subtle/25 p-4 shadow-[0_18px_42px_-30px_rgba(15,23,42,.40)] transition duration-200 hover:-translate-y-0.5 hover:shadow-md dark:shadow-[0_18px_42px_-30px_rgba(0,0,0,.9)]">
      <span
        className={`grid size-9 place-items-center rounded-xl ${colors[tone]}`}
      >
        <Icon className="size-4" />
      </span>
      <p className="mt-4 text-xs font-medium text-ink-secondary">{title}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-ink">
        {value}
      </p>
      <p className="mt-1 text-xs text-ink-muted">{text}</p>
    </article>
  );
}
function CourseDetail({
  course,
  materials,
  loading,
  orgSlug,
  fr,
  canUpdate,
  canCreate,
  onEdit,
  onAddMaterial,
  onOpenProfessionalBuilder,
  archivePending,
  onSetActive,
}: {
  course: Course | null;
  materials: Material[];
  loading: boolean;
  orgSlug: string;
  fr: boolean;
  canUpdate: boolean;
  canCreate: boolean;
  onEdit: () => void;
  onAddMaterial: () => void;
  onOpenProfessionalBuilder: () => void;
  archivePending: boolean;
  onSetActive: (course: Course) => void;
}) {
  if (!course)
    return (
      <aside className="rounded-2xl border border-dashed border-border bg-surface-1 p-6">
        <GraduationCap className="size-6 text-ink-muted" />
        <h2 className="mt-4 text-base font-semibold text-ink">
          {label(fr, "Select a training", "Sélectionnez une formation")}
        </h2>
        <p className="mt-1 text-sm leading-6 text-ink-secondary">
          {label(
            fr,
            "Its audience, expiry rule and learning material will appear here.",
            "Son public, sa règle de renouvellement et ses supports apparaîtront ici.",
          )}
        </p>
      </aside>
    );
  return (
    <aside className="rounded-2xl border border-border bg-surface-1 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand">
            {words(course.category)}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-ink">{course.name}</h2>
          <p className="mt-1 text-xs text-ink-secondary">{course.code}</p>
        </div>
        {course.isMandatory ? (
          <Badge variant="warning">
            {label(fr, "Required", "Obligatoire")}
          </Badge>
        ) : null}
      </div>
      {course.description ? (
        <p className="mt-4 text-sm leading-6 text-ink-secondary">
          {course.description}
        </p>
      ) : null}
      <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <Info
          title={label(fr, "Assigned", "Affectées")}
          value={String(course.assignmentCount)}
        />
        <Info
          title={label(fr, "Completed", "Terminées")}
          value={String(course.completedCount)}
        />
        <Info
          title={label(fr, "Validity", "Validité")}
          value={
            course.validityMonths
              ? `${course.validityMonths} ${label(fr, "months", "mois")}`
              : label(fr, "No expiry", "Sans expiration")
          }
        />
        <Info
          title={label(fr, "Status", "Statut")}
          value={
            course.isActive
              ? label(fr, "Active", "Active")
              : label(fr, "Inactive", "Inactive")
          }
        />
      </dl>
      <div className="mt-5 flex flex-wrap gap-2">
        {canUpdate ? (
          <Button size="sm" variant="secondary" onClick={onEdit}>
            {label(fr, "Edit", "Modifier")}
          </Button>
        ) : null}
        {canCreate ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={onOpenProfessionalBuilder}
          >
            <GraduationCap />
            {label(fr, "Professional builder", "Constructeur professionnel")}
          </Button>
        ) : null}
        {canCreate ? (
          <Button size="sm" onClick={onAddMaterial}>
            <Plus />
            {label(fr, "Add material", "Ajouter un support")}
          </Button>
        ) : null}
        {canUpdate ? (
          <Button
            size="sm"
            variant={course.isActive ? "destructive" : "secondary"}
            loading={archivePending}
            onClick={() => onSetActive(course)}
          >
            {course.isActive
              ? label(fr, "Archive course", "Archiver le cours")
              : label(fr, "Restore course", "Réactiver le cours")}
          </Button>
        ) : null}
      </div>
      <div className="mt-5 border-t border-border pt-4">
        <div className="flex items-center gap-2">
          <BookOpenCheck className="size-4 text-brand" />
          <h3 className="text-sm font-semibold text-ink">
            {label(fr, "Learning materials", "Supports de formation")}
          </h3>
        </div>
        {loading ? (
          <p className="mt-3 text-sm text-ink-secondary">
            {label(fr, "Loading materials…", "Chargement des supports…")}
          </p>
        ) : materials.length ? (
          <div className="mt-3 space-y-2">
            {materials.map((material) => (
              <a
                key={material.id}
                href={
                  material.externalUrl ??
                  (material.documentId
                    ? orgApiUrl(
                        orgSlug,
                        `documents/${material.documentId}/preview`,
                      )
                    : "#")
                }
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 rounded-xl border border-border p-3 transition hover:border-brand/35 hover:bg-brand/5"
              >
                <MaterialIcon type={material.materialType} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-ink">
                      {material.title}
                    </span>
                    {material.isRequired ? (
                      <Badge variant="outline">
                        {label(fr, "Required", "Requis")}
                      </Badge>
                    ) : null}
                  </span>
                  <span className="mt-1 block truncate text-xs text-ink-secondary">
                    {material.description ?? words(material.materialType)}
                  </span>
                </span>
                <ExternalLink className="size-4 text-ink-muted" />
              </a>
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-xl border border-dashed border-border p-3 text-xs leading-5 text-ink-secondary">
            {label(
              fr,
              "No material yet. Add a secure video, document or learning link.",
              "Aucun support pour le moment. Ajoutez une vidéo, un document ou un lien de formation sécurisé.",
            )}
          </p>
        )}
      </div>
    </aside>
  );
}
function MaterialIcon({ type }: { type: Material["materialType"] }) {
  const Icon =
    type === "video"
      ? PlayCircle
      : type === "document"
        ? FileText
        : type === "link"
          ? LinkIcon
          : ClipboardCheck;
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-3 text-brand">
      <Icon className="size-4" />
    </span>
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
function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/55 p-4"
      role="dialog"
      aria-modal="true"
    >
      <section className={`max-h-[92dvh] w-full overflow-y-auto rounded-3xl border border-border bg-surface-1 shadow-2xl ${wide ? "max-w-6xl" : "max-w-xl"}`}>
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
function CourseDialog({
  fr,
  orgSlug,
  course,
  onClose,
}: {
  fr: boolean;
  orgSlug: string;
  course: Course | null;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [code, setCode] = useState(course?.code ?? "");
  const [codeError, setCodeError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      course
        ? patch<{ course: Course }>(
            orgUrl(orgSlug, `training-courses/${course.id}`),
            body,
          )
        : post<{ course: Course }>(orgUrl(orgSlug, "training-courses"), body),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["training-courses", orgSlug],
      });
      void client.invalidateQueries({
        queryKey: ["training-summary", orgSlug],
      });
      onClose();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const validity = String(form.get("validityMonths") ?? "").trim();
    const name = String(form.get("name") ?? "").trim();
    const normalizedCode = trainingCode(code || name);
    if (!/^[a-z][a-z0-9_]{1,62}$/.test(normalizedCode)) {
      setCodeError(
        label(
          fr,
          "Use at least 2 lowercase letters, numbers or underscores.",
          "Utilisez au moins 2 lettres minuscules, chiffres ou traits de soulignement.",
        ),
      );
      return;
    }
    setCodeError(null);
    mutation.mutate({
      code: normalizedCode,
      name,
      description: String(form.get("description") ?? "").trim() || null,
      category: String(form.get("category") ?? "general"),
      validityMonths: validity ? Number(validity) : null,
      isMandatory: form.get("isMandatory") === "on",
      isActive: form.get("isActive") === "on",
    });
  };
  return (
    <Dialog
      title={
        course
          ? label(fr, "Edit training", "Modifier la formation")
          : label(fr, "Create training", "Créer une formation")
      }
      onClose={onClose}
    >
      <form className="space-y-4" onSubmit={submit}>
        {apiError(mutation.error) ? (
          <p className="rounded-lg bg-critical/10 p-3 text-sm text-critical">
            {apiError(mutation.error)}
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={label(fr, "Course name", "Nom de la formation")}
            required
          >
            <Input
              name="name"
              defaultValue={course?.name}
              required
              onBlur={(event) => {
                if (!code.trim())
                  setCode(trainingCode(event.currentTarget.value));
              }}
            />
          </Field>
          <Field
            label={label(fr, "Course code", "Code formation")}
            hint={
              codeError ??
              label(
                fr,
                "Generated safely from the name when left blank. Use lowercase letters, numbers and underscores.",
                "Généré automatiquement depuis le nom si vide. Utilisez des minuscules, chiffres et traits de soulignement.",
              )
            }
            error={codeError ?? undefined}
          >
            <Input
              name="code"
              value={code}
              onChange={(event) => {
                setCode(trainingCode(event.target.value));
                setCodeError(null);
              }}
              placeholder="biosecurity_01"
            />
          </Field>
        </div>
        <Field label={label(fr, "Category", "Catégorie")} required>
          <select
            className={selectClass}
            name="category"
            defaultValue={course?.category ?? "general"}
          >
            {[
              "general",
              "safety",
              "biosecurity",
              "technical",
              "compliance",
              "induction",
              "management",
            ].map((value) => (
              <option key={value} value={value}>
                {words(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={label(fr, "Description", "Description")}>
          <Textarea
            name="description"
            defaultValue={course?.description ?? ""}
            rows={4}
          />
        </Field>
        <Field
          label={label(fr, "Validity in months", "Validité en mois")}
          hint={label(
            fr,
            "Leave blank if this course never expires.",
            "Laissez vide si cette formation n’expire pas.",
          )}
        >
          <Input
            name="validityMonths"
            type="number"
            min="1"
            max="600"
            defaultValue={course?.validityMonths ?? ""}
          />
        </Field>
        <label className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm text-ink">
          <input
            name="isMandatory"
            type="checkbox"
            defaultChecked={course?.isMandatory}
          />
          {label(
            fr,
            "Mandatory for assigned employees",
            "Obligatoire pour les employés affectés",
          )}
        </label>
        <label className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm text-ink">
          <input
            name="isActive"
            type="checkbox"
            defaultChecked={course?.isActive ?? true}
          />
          {label(fr, "Active in the catalogue", "Active dans le catalogue")}
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {label(fr, "Cancel", "Annuler")}
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {course
              ? label(fr, "Save changes", "Enregistrer")
              : label(fr, "Create training", "Créer")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
function AssignmentDialog({
  fr,
  orgSlug,
  courses,
  employees,
  hasEmployeeAccess,
  onClose,
}: {
  fr: boolean;
  orgSlug: string;
  courses: Course[];
  employees: Employee[];
  hasEmployeeAccess: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      post<{ assignments: Assignment[] }>(
        orgUrl(orgSlug, "training-assignments"),
        body,
      ),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["training-assignments", orgSlug],
      });
      void client.invalidateQueries({
        queryKey: ["training-summary", orgSlug],
      });
      void client.invalidateQueries({
        queryKey: ["training-courses", orgSlug],
      });
      onClose();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    mutation.mutate({
      courseId: String(form.get("courseId") ?? ""),
      employeeIds: form.getAll("employeeIds").map(String),
      dueOn: String(form.get("dueOn") ?? "").trim() || null,
      notes: String(form.get("notes") ?? "").trim() || null,
    });
  };
  return (
    <Dialog
      title={label(fr, "Assign training", "Affecter une formation")}
      onClose={onClose}
    >
      <form className="space-y-4" onSubmit={submit}>
        {apiError(mutation.error) ? (
          <p className="rounded-lg bg-critical/10 p-3 text-sm text-critical">
            {apiError(mutation.error)}
          </p>
        ) : null}
        <Field label={label(fr, "Training course", "Formation")} required>
          <select
            className={selectClass}
            name="courseId"
            required
            defaultValue=""
          >
            <option value="">
              {label(fr, "Choose a course", "Choisir une formation")}
            </option>
            {courses
              .filter((course) => course.isActive)
              .map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name} · {words(course.category)}
                </option>
              ))}
          </select>
        </Field>
        <Field
          label={label(fr, "Employees", "Employés")}
          required
          hint={label(
            fr,
            "Select one or more people who must complete this course.",
            "Sélectionnez une ou plusieurs personnes qui doivent terminer cette formation.",
          )}
        >
          {hasEmployeeAccess ? (
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
              {employees.length ? (
                employees.map((employee) => (
                  <label
                    key={employee.id}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-surface-2"
                  >
                    <input
                      name="employeeIds"
                      type="checkbox"
                      value={employee.id}
                    />
                    <span>
                      <b className="text-ink">{employee.fullName}</b>
                      <span className="block text-xs text-ink-secondary">
                        #{employee.employeeNumber} · {employee.jobTitle}
                      </span>
                    </span>
                  </label>
                ))
              ) : (
                <p className="p-3 text-sm text-ink-secondary">
                  {label(
                    fr,
                    "No active employee is available.",
                    "Aucun employé actif disponible.",
                  )}
                </p>
              )}
            </div>
          ) : (
            <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning-ink">
              {label(
                fr,
                "You need employee-directory permission to assign training.",
                "Vous devez avoir l’autorisation d’accéder aux employés pour affecter une formation.",
              )}
            </p>
          )}
        </Field>
        <Field label={label(fr, "Due date", "Échéance")}>
          <Input name="dueOn" type="date" />
        </Field>
        <Field label={label(fr, "Assignment note", "Note d’affectation")}>
          <Textarea name="notes" rows={3} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {label(fr, "Cancel", "Annuler")}
          </Button>
          <Button
            type="submit"
            loading={mutation.isPending}
            disabled={!hasEmployeeAccess || !employees.length}
          >
            {label(fr, "Assign", "Affecter")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
function MaterialDialog({
  fr,
  orgSlug,
  course,
  onClose,
}: {
  fr: boolean;
  orgSlug: string;
  course: Course;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: async ({
      body,
      file,
    }: {
      body: Record<string, unknown>;
      file: File | null;
    }) => {
      let documentId: string | null = null;
      if (file) {
        const upload = new FormData();
        upload.set("file", file);
        upload.set("title", String(body.title));
        upload.set("category", "general");
        const uploaded = await api.post<{ document: { id: string } }>(
          orgUrl(orgSlug, "documents"),
          upload,
          { headers: { "Content-Type": "multipart/form-data" } },
        );
        documentId = uploaded.data.document.id;
      }
      return post<{ material: Material }>(
        orgUrl(orgSlug, `training-courses/${course.id}/materials`),
        { ...body, externalUrl: body.externalUrl || null, documentId },
      );
    },
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["training-materials", orgSlug, course.id],
      });
      onClose();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    const externalUrl = String(form.get("externalUrl") ?? "").trim();
    const materialType = String(form.get("materialType") ?? "document");
    let quizQuestions: QuizQuestionInput[] = [];
    try {
      quizQuestions = parseQuizLines(
        String(form.get("quizQuestions") ?? ""),
        fr,
      );
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : label(
              fr,
              "Quiz format is invalid.",
              "Le format du quiz est invalide.",
            ),
      );
      return;
    }
    if (
      !externalUrl &&
      !(file instanceof File && file.size) &&
      !quizQuestions.length
    ) {
      setFormError(
        label(
          fr,
          "Add a secure link, choose a file, or add assessment questions.",
          "Ajoutez un lien sécurisé, choisissez un fichier ou ajoutez des questions d’évaluation.",
        ),
      );
      return;
    }
    const passingScore = String(form.get("quizPassingScore") ?? "").trim();
    if (passingScore && !quizQuestions.length) {
      setFormError(
        label(
          fr,
          "Add quiz questions before setting a passing score.",
          "Ajoutez des questions avant de fixer une note de réussite.",
        ),
      );
      return;
    }
    setFormError(null);
    const duration = String(form.get("estimatedDurationMinutes") ?? "").trim();
    const order = String(form.get("sortOrder") ?? "").trim();
    mutation.mutate({
      file: file instanceof File && file.size ? file : null,
      body: {
        title: String(form.get("title") ?? "").trim(),
        materialType,
        externalUrl,
        description: String(form.get("description") ?? "").trim() || null,
        estimatedDurationMinutes: duration ? Number(duration) : null,
        sortOrder: order ? Number(order) : 0,
        requiresAcknowledgment: form.get("requiresAcknowledgment") === "on",
        quizQuestions: quizQuestions.length ? quizQuestions : null,
        quizPassingScore: passingScore ? Number(passingScore) : null,
        isRequired: form.get("isRequired") === "on",
      },
    });
  };
  return (
    <Dialog
      title={label(fr, "Add learning material", "Ajouter un support")}
      onClose={onClose}
    >
      <form className="space-y-4" onSubmit={submit}>
        {formError || apiError(mutation.error) ? (
          <p className="rounded-lg bg-critical/10 p-3 text-sm text-critical">
            {formError ?? apiError(mutation.error)}
          </p>
        ) : null}
        <p className="rounded-xl bg-brand/5 p-3 text-xs leading-5 text-ink-secondary">
          {label(
            fr,
            "Add a secure company document/video or an approved external learning link. The same support is used in every employee learning path.",
            "Ajoutez un document ou une vidéo sécurisée de l’entreprise, ou un lien de formation externe approuvé. Le même support est utilisé dans chaque parcours employé.",
          )}
        </p>
        <Field label={label(fr, "Lesson title", "Titre de la leçon")} required>
          <Input name="title" required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={label(fr, "Material type", "Type de support")} required>
            <select
              className={selectClass}
              name="materialType"
              defaultValue="document"
            >
              {["document", "video", "link", "assessment", "other"].map(
                (value) => (
                  <option key={value} value={value}>
                    {words(value)}
                  </option>
                ),
              )}
            </select>
          </Field>
          <Field
            label={label(fr, "Order", "Ordre")}
            hint={label(
              fr,
              "Lower numbers appear first.",
              "Les petits nombres apparaissent en premier.",
            )}
          >
            <Input name="sortOrder" type="number" min="0" defaultValue="0" />
          </Field>
        </div>
        <Field
          label={label(fr, "Secure external link", "Lien externe sécurisé")}
          hint={label(
            fr,
            "Optional when you upload a document or video below.",
            "Facultatif si vous téléversez un document ou une vidéo ci-dessous.",
          )}
        >
          <Input name="externalUrl" type="url" placeholder="https://…" />
        </Field>
        <Field
          label={label(
            fr,
            "Document or video file",
            "Fichier document ou vidéo",
          )}
          hint={label(
            fr,
            "PDF, Office file, image, MP4 or WebM. Size limits follow the company upload policy.",
            "PDF, fichier Office, image, MP4 ou WebM. Les limites suivent la politique de téléversement de l’entreprise.",
          )}
        >
          <Input
            name="file"
            type="file"
            accept="application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,image/jpeg,image/png,image/webp,video/mp4,video/webm"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={label(
              fr,
              "Estimated duration (minutes)",
              "Durée estimée (minutes)",
            )}
          >
            <Input
              name="estimatedDurationMinutes"
              type="number"
              min="1"
              max="1440"
            />
          </Field>
          <Field label={label(fr, "Description", "Description")}>
            <Textarea name="description" rows={2} />
          </Field>
        </div>
        <Field
          label={label(
            fr,
            "Quiz questions (optional)",
            "Questions du quiz (facultatif)",
          )}
          hint={label(
            fr,
            "One line per question: Question | answer 1 | answer 2 | correct answer number. Use Assessment for a quiz-only lesson.",
            "Une ligne par question : Question | réponse 1 | réponse 2 | numéro de la bonne réponse. Utilisez Évaluation pour une leçon de quiz seule.",
          )}
        >
          <Textarea
            name="quizQuestions"
            rows={4}
            placeholder={label(
              fr,
              "When should hands be washed? | Before work | Never | 1",
              "Quand faut-il se laver les mains ? | Avant le travail | Jamais | 1",
            )}
          />
        </Field>
        <Field
          label={label(
            fr,
            "Quiz passing score (%)",
            "Note de réussite du quiz (%)",
          )}
          hint={label(
            fr,
            "Leave blank if a submitted quiz does not require a minimum score.",
            "Laissez vide si le quiz ne nécessite pas de note minimale.",
          )}
        >
          <Input name="quizPassingScore" type="number" min="0" max="100" />
        </Field>
        <label className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm text-ink">
          <input name="isRequired" type="checkbox" defaultChecked />
          {label(fr, "Required lesson", "Leçon obligatoire")}
        </label>
        <label className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm text-ink">
          <input name="requiresAcknowledgment" type="checkbox" />
          {label(
            fr,
            "Require learner acknowledgement",
            "Exiger une reconnaissance de lecture",
          )}
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {label(fr, "Cancel", "Annuler")}
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {label(fr, "Add material", "Ajouter")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
function RecordDialog({
  fr,
  orgSlug,
  courses,
  employees,
  hasEmployeeAccess,
  onClose,
}: {
  fr: boolean;
  orgSlug: string;
  courses: Course[];
  employees: Employee[];
  hasEmployeeAccess: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      post<{ record: RecordItem }>(orgUrl(orgSlug, "training-records"), body),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["training-records", orgSlug],
      });
      void client.invalidateQueries({
        queryKey: ["training-summary", orgSlug],
      });
      onClose();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const score = String(form.get("score") ?? "").trim();
    mutation.mutate({
      employeeId: String(form.get("employeeId") ?? ""),
      courseId: String(form.get("courseId") ?? ""),
      completedOn: String(form.get("completedOn") ?? ""),
      result: String(form.get("result") ?? "passed"),
      score: score ? Number(score) : null,
      trainer: String(form.get("trainer") ?? "").trim() || null,
      certificateNumber:
        String(form.get("certificateNumber") ?? "").trim() || null,
      notes: String(form.get("notes") ?? "").trim() || null,
    });
  };
  return (
    <Dialog
      title={label(
        fr,
        "Record training completion",
        "Enregistrer une réussite",
      )}
      onClose={onClose}
    >
      <form className="space-y-4" onSubmit={submit}>
        {apiError(mutation.error) ? (
          <p className="rounded-lg bg-critical/10 p-3 text-sm text-critical">
            {apiError(mutation.error)}
          </p>
        ) : null}
        <Field label={label(fr, "Employee", "Employé")} required>
          <select
            className={selectClass}
            name="employeeId"
            defaultValue=""
            required
            disabled={!hasEmployeeAccess}
          >
            <option value="">
              {label(fr, "Choose an employee", "Choisir un employé")}
            </option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.fullName} · #{employee.employeeNumber}
              </option>
            ))}
          </select>
        </Field>
        <Field label={label(fr, "Training course", "Formation")} required>
          <select
            className={selectClass}
            name="courseId"
            defaultValue=""
            required
          >
            <option value="">
              {label(fr, "Choose a course", "Choisir une formation")}
            </option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={label(fr, "Completion date", "Date de réussite")}
            required
          >
            <Input
              name="completedOn"
              type="date"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
          </Field>
          <Field label={label(fr, "Result", "Résultat")} required>
            <select className={selectClass} name="result" defaultValue="passed">
              <option value="passed">{label(fr, "Passed", "Réussi")}</option>
              <option value="attended">
                {label(fr, "Attended", "Présent")}
              </option>
              <option value="failed">{label(fr, "Failed", "Échec")}</option>
              <option value="in_progress">
                {label(fr, "In progress", "En cours")}
              </option>
            </select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={label(fr, "Score", "Score")}>
            <Input name="score" type="number" min="0" max="100" />
          </Field>
          <Field
            label={label(fr, "Certificate number", "Numéro de certificat")}
          >
            <Input name="certificateNumber" />
          </Field>
        </div>
        <Field label={label(fr, "Trainer", "Formateur")}>
          <Input name="trainer" />
        </Field>
        <Field label={label(fr, "Notes", "Notes")}>
          <Textarea name="notes" rows={3} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {label(fr, "Cancel", "Annuler")}
          </Button>
          <Button
            type="submit"
            loading={mutation.isPending}
            disabled={!hasEmployeeAccess}
          >
            {label(fr, "Save record", "Enregistrer")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
