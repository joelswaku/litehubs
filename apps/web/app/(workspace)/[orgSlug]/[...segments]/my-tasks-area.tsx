"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ClipboardList,
  Clock3,
  MapPin,
  TriangleAlert,
  ImagePlus,
  FileText,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/ui/states";
import { Textarea } from "@/components/ui/input";
import { get, orgUrl, patch, post } from "@/lib/api";
import { useLanguage } from "@/providers/language-provider";

type Task = {
  id: string;
  code?: string | null;
  title: string;
  description?: string | null;
  status:
    | "not_started"
    | "in_progress"
    | "blocked"
    | "waiting_approval"
    | "completed"
    | "cancelled";
  priority?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  projectProgressPercent?: number | string | null;
  projectId?: string | null;
  blockedReason?: string | null;
  notes?: string | null;
  projectName?: string | null;
  projectCode?: string | null;
  phaseName?: string | null;
  siteName?: string | null;
  provinceName?: string | null;
};

type TaskUpdate = {
  status?: "in_progress" | "blocked" | "waiting_approval" | "completed";

  blockedReason?: string | null;
  notes?: string | null;
};

const copy = (fr: boolean, en: string, french: string) => (fr ? french : en);
const text = (value: unknown) => String(value ?? "").trim();
const statusLabel = (status: string, fr: boolean) => {
  const labels: Record<string, [string, string]> = {
    not_started: ["Not started", "Non commencée"],
    in_progress: ["In progress", "En cours"],
    blocked: ["Blocked", "Bloquée"],
    waiting_approval: ["Awaiting approval", "En attente de validation"],
    completed: ["Completed", "Terminée"],
    cancelled: ["Cancelled", "Annulée"],
  };
  const label = labels[status] ?? [status, status];
  return fr ? label[1] : label[0];
};
const priorityLabel = (priority: string, fr: boolean) => {
  const labels: Record<string, [string, string]> = {
    low: ["Low", "Faible"],
    medium: ["Medium", "Moyenne"],
    high: ["High", "Élevée"],
    critical: ["Critical", "Critique"],
  };
  const label = labels[priority] ?? [priority, priority];
  return fr ? label[1] : label[0];
};

export function MyTasksArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const client = useQueryClient();
  const tasks = useQuery({
    queryKey: ["my-tasks", orgSlug],
    queryFn: () => get<{ records: Task[] }>(orgUrl(orgSlug, "my-tasks")),
    select: (data) => data.records,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => (tasks.data ?? []).find((task) => task.id === selectedId) ?? null,
    [selectedId, tasks.data],
  );
  const [status, setStatus] = useState<TaskUpdate["status"]>("in_progress");

  const [blocker, setBlocker] = useState("");
  const [notes, setNotes] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);

  useEffect(() => {
    if (!selected) return;
    setStatus(
      ["in_progress", "blocked", "waiting_approval", "completed"].includes(
        selected.status,
      )
        ? (selected.status as TaskUpdate["status"])
        : "in_progress",
    );

    setBlocker(text(selected.blockedReason));
    setNotes(text(selected.notes));
    setEvidenceFile(null);
  }, [selected]);

  useEffect(() => {
    if (selectedId || !tasks.data?.length) return;
    setSelectedId(tasks.data[0]?.id ?? null);
  }, [selectedId, tasks.data]);

  const save = useMutation({
    mutationFn: ({ id, body }: { id: string; body: TaskUpdate }) =>
      patch<{ record: Task }>(orgUrl(orgSlug, `my-tasks/${id}`), body),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["my-tasks", orgSlug] });
      toast.success(copy(fr, "Work update saved", "Mise à jour enregistrée"));
    },
  });

  const uploadEvidence = useMutation({
    mutationFn: async ({ task, file }: { task: Task; file: File }) => {
      const form = new FormData();
      form.set("file", file);
      form.set(
        "title",
        `${task.title} · ${copy(fr, "field evidence", "preuve terrain")}`,
      );
      form.set(
        "altText",
        `${copy(fr, "Field evidence for", "Preuve terrain pour")} ${task.title}`,
      );
      const isPdf =
        file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      if (isPdf)
        return post<{ document: { id: string } }>(
          orgUrl(orgSlug, `task-evidence/${task.id}`),
          form,
          { headers: { "Content-Type": "multipart/form-data" } },
        );
      form.set("imageType", "task_evidence");
      return post<{ image: { id: string } }>(
        orgUrl(orgSlug, `images/owner-management/tasks/${task.id}`),
        form,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["my-tasks", orgSlug] });
      setEvidenceFile(null);
      toast.success(
        copy(
          fr,
          "Photo added to the project documents",
          "Photo ajoutée aux documents du projet",
        ),
      );
    },
  });

  const openTasks = (tasks.data ?? []).filter(
    (task) => !["completed", "cancelled"].includes(task.status),
  );
  const blockedCount = openTasks.filter(
    (task) => task.status === "blocked",
  ).length;
  const dueToday = openTasks.filter(
    (task) => text(task.dueDate) === new Date().toISOString().slice(0, 10),
  ).length;
  const saveSelected = async () => {
    if (!selected) return;
    try {
      await save.mutateAsync({
        id: selected.id,
        body: {
          status,
          blockedReason: blocker.trim() || null,
          notes: notes.trim() || null,
        },
      });
      if (evidenceFile)
        await uploadEvidence.mutateAsync({
          task: selected,
          file: evidenceFile,
        });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : copy(
              fr,
              "Could not save this update",
              "Impossible d’enregistrer cette mise à jour",
            ),
      );
    }
  };
  const complete = async (task: Task) => {
    try {
      await save.mutateAsync({ id: task.id, body: { status: "completed" } });
      if (evidenceFile && selected?.id === task.id)
        await uploadEvidence.mutateAsync({ task, file: evidenceFile });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : copy(
              fr,
              "Could not complete this task",
              "Impossible de terminer cette tâche",
            ),
      );
    }
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <section className="overflow-hidden rounded-2xl border border-brand/20 bg-[linear-gradient(125deg,#0d366b_0%,#2a78d6_100%)] p-5 text-white shadow-sm sm:p-7">
        <ClipboardList className="size-6 text-blue-100" aria-hidden />
        <h1 className="mt-4 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
          {copy(fr, "My assigned tasks", "Mes tâches attribuées")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-50/90">
          {copy(
            fr,
            "Only work assigned to you appears here. Update its status, report a blocker, attach evidence, then send the completed work to your supervisor.",
            "Seul le travail qui vous est attribué apparaît ici. Mettez à jour son statut, signalez un blocage, ajoutez une preuve, puis transmettez le travail terminé à votre responsable.",
          )}
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          [
            copy(fr, "Open work", "Travail ouvert"),
            openTasks.length,
            ClipboardList,
          ],
          [copy(fr, "Due today", "À faire aujourd’hui"), dueToday, Clock3],
          [copy(fr, "Blocked", "Bloquées"), blockedCount, TriangleAlert],
        ].map(([label, value, Icon]) => {
          const StatIcon = Icon as typeof ClipboardList;
          return (
            <div
              key={String(label)}
              className="rounded-2xl border border-border bg-surface-1 p-4 shadow-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-ink-secondary">
                  {String(label)}
                </p>
                <StatIcon className="size-4 text-brand" aria-hidden />
              </div>
              <p className="mt-2 text-3xl font-semibold tabular-nums text-ink">
                {Number(value)}
              </p>
            </div>
          );
        })}
      </section>

      {tasks.isLoading ? (
        <SkeletonCard />
      ) : tasks.isError ? (
        <ErrorState
          description={(tasks.error as Error).message}
          onRetry={() => void tasks.refetch()}
        />
      ) : !tasks.data?.length ? (
        <EmptyState
          icon={ClipboardList}
          title={copy(fr, "No assigned task", "Aucune tâche attribuée")}
          description={copy(
            fr,
            "When a manager assigns you work, it will appear here and in your notifications.",
            "Lorsqu’un responsable vous attribuera un travail, il apparaîtra ici et dans vos notifications.",
          )}
        />
      ) : (
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,.9fr)]">
          <div className="space-y-3">
            {(tasks.data ?? []).map((task) => {
              const active = task.id === selected?.id;
              const location = [text(task.siteName), text(task.provinceName)]
                .filter(Boolean)
                .join(" · ");
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => setSelectedId(task.id)}
                  className={`group w-full rounded-2xl border p-4 text-left shadow-sm transition ${active ? "border-brand bg-brand/5 ring-1 ring-brand/15" : "border-border bg-surface-1 hover:border-brand/40"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-ink group-hover:text-brand">
                        {task.title}
                      </p>
                      <p className="mt-1 truncate text-xs text-ink-secondary">
                        {[
                          text(task.projectName),
                          text(task.phaseName),
                          location,
                        ]
                          .filter(Boolean)
                          .join(" · ") ||
                          copy(fr, "Company work", "Travail d’entreprise")}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${task.status === "completed" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : task.status === "blocked" ? "bg-critical/10 text-critical" : "bg-brand/10 text-brand"}`}
                    >
                      {statusLabel(task.status, fr)}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
                    <span className="rounded bg-surface-2 px-2 py-1">
                      {priorityLabel(text(task.priority) || "medium", fr)}
                    </span>
                    {task.dueDate ? (
                      <span>
                        {copy(
                          fr,
                          `Due ${task.dueDate}`,
                          `Échéance ${task.dueDate}`,
                        )}
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>

          {selected ? (
            <aside className="rounded-2xl border border-border bg-surface-1 p-4 shadow-sm sm:p-5 xl:sticky xl:top-6 xl:self-start">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
                    {copy(fr, "Work update", "Mise à jour du travail")}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-ink">
                    {selected.title}
                  </h2>
                </div>
                {selected.status !== "completed" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={save.isPending || uploadEvidence.isPending}
                    onClick={() => void complete(selected)}
                  >
                    <CheckCircle2 />
                    {copy(fr, "Complete", "Terminer")}
                  </Button>
                ) : null}
              </div>
              {selected.description ? (
                <p className="mt-3 text-sm leading-6 text-ink-secondary">
                  {selected.description}
                </p>
              ) : null}
              <div className="mt-4 rounded-xl border border-border bg-surface-2 p-3 text-xs leading-5 text-ink-secondary">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-3.5 text-brand" />
                  {[text(selected.siteName), text(selected.provinceName)]
                    .filter(Boolean)
                    .join(" · ") ||
                    copy(fr, "Company work", "Travail d’entreprise")}
                </span>
                {selected.dueDate ? (
                  <p className="mt-1">
                    {copy(
                      fr,
                      `Due ${selected.dueDate}`,
                      `Échéance ${selected.dueDate}`,
                    )}
                  </p>
                ) : null}
              </div>
              {selected.projectName ? (
                <div className="mt-4 rounded-xl border border-brand/20 bg-brand/5 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-ink">
                        {copy(fr, "Project progress", "Avancement du projet")}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-ink-secondary">
                        {copy(
                          fr,
                          "Calculated automatically from all project work.",
                          "Calculé automatiquement à partir de tous les travaux du projet.",
                        )}
                      </p>
                    </div>
                    <strong className="text-xl font-semibold tabular-nums text-brand">
                      {Math.round(
                        Math.max(
                          0,
                          Math.min(
                            100,
                            Number(selected.projectProgressPercent ?? 0),
                          ),
                        ),
                      )}
                      %
                    </strong>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <div
                      className="h-full rounded-full bg-brand transition-[width]"
                      style={{
                        width: `${Math.max(0, Math.min(100, Number(selected.projectProgressPercent ?? 0)))}%`,
                      }}
                    />
                  </div>
                </div>
              ) : null}
              {selected.status !== "completed" &&
              selected.status !== "cancelled" ? (
                <div className="mt-5 space-y-4">
                  <label className="grid gap-1.5 text-sm font-medium text-ink">
                    {copy(fr, "Work status", "Statut du travail")}
                    <select
                      value={status}
                      onChange={(event) =>
                        setStatus(event.target.value as TaskUpdate["status"])
                      }
                      className="control h-10 w-full"
                    >
                      <option value="in_progress">
                        {copy(fr, "In progress", "En cours")}
                      </option>
                      <option value="blocked">
                        {copy(fr, "Blocked", "Bloquée")}
                      </option>
                      <option value="waiting_approval">
                        {copy(
                          fr,
                          "Awaiting approval",
                          "En attente de validation",
                        )}
                      </option>
                      <option value="completed">
                        {copy(fr, "Completed", "Terminée")}
                      </option>
                    </select>
                  </label>

                  <label className="grid gap-1.5 text-sm font-medium text-ink">
                    {copy(fr, "Blocker", "Blocage")}
                    <Textarea
                      value={blocker}
                      onChange={(event) => setBlocker(event.target.value)}
                      placeholder={copy(
                        fr,
                        "What is preventing the work?",
                        "Qu’est-ce qui bloque le travail ?",
                      )}
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm font-medium text-ink">
                    {copy(fr, "Work note", "Note de travail")}
                    <Textarea
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      placeholder={copy(
                        fr,
                        "State what was done or needs follow-up.",
                        "Indiquez ce qui a été fait ou ce qui doit être suivi.",
                      )}
                    />
                  </label>
                  <div className="rounded-xl border border-dashed border-brand/35 bg-brand/5 p-3">
                    <div className="flex items-start gap-3">
                      <ImagePlus
                        className="mt-0.5 size-5 shrink-0 text-brand"
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-ink">
                          {copy(
                            fr,
                            "Photo or PDF evidence",
                            "Photo ou preuve PDF",
                          )}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-ink-secondary">
                          {copy(
                            fr,
                            "Optional. A photo or PDF is saved in this project's documents and linked to this task.",
                            "Facultatif. Une photo ou un PDF est enregistré dans les documents de ce projet et lié à cette tâche.",
                          )}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <label className="inline-flex cursor-pointer items-center rounded-lg border border-border bg-surface-1 px-3 py-2 text-xs font-semibold text-ink transition hover:border-brand/50 hover:text-brand">
                            <ImagePlus className="mr-1.5 size-3.5" />
                            {copy(fr, "Add a photo", "Ajouter une photo")}
                            <input
                              className="sr-only"
                              type="file"
                              accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
                              capture="environment"
                              onChange={(event) =>
                                setEvidenceFile(event.target.files?.[0] ?? null)
                              }
                            />
                          </label>
                          <label className="inline-flex cursor-pointer items-center rounded-lg border border-border bg-surface-1 px-3 py-2 text-xs font-semibold text-ink transition hover:border-brand/50 hover:text-brand">
                            <FileText className="mr-1.5 size-3.5" />
                            {copy(fr, "Add a PDF", "Ajouter un PDF")}
                            <input
                              className="sr-only"
                              type="file"
                              accept="application/pdf,.pdf"
                              onChange={(event) =>
                                setEvidenceFile(event.target.files?.[0] ?? null)
                              }
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                    {evidenceFile ? (
                      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-surface-1 px-3 py-2 text-xs text-ink-secondary">
                        <span className="min-w-0 truncate">
                          {evidenceFile.name}
                        </span>
                        <button
                          type="button"
                          className="inline-flex shrink-0 items-center gap-1 font-semibold text-ink hover:text-critical"
                          onClick={() => setEvidenceFile(null)}
                        >
                          <X className="size-3.5" />
                          {copy(fr, "Remove", "Retirer")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <Button
                    className="w-full"
                    loading={save.isPending || uploadEvidence.isPending}
                    onClick={() => void saveSelected()}
                  >
                    {copy(fr, "Save work update", "Enregistrer la mise à jour")}
                  </Button>
                </div>
              ) : (
                <p className="mt-5 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-200">
                  {copy(
                    fr,
                    "This task is complete and has been sent to your supervisor.",
                    "Cette tâche est terminée et transmise à votre responsable.",
                  )}
                </p>
              )}
            </aside>
          ) : null}
        </section>
      )}
    </main>
  );
}
