"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { poultryApi } from "@/lib/poultry-api";

type Member = { id: string; label: string };
const workTypes = [
  "feed_record",
  "water_record",
  "weight_check",
  "egg_collection",
  "mortality_review",
  "vaccination",
  "health_check",
  "climate_check",
  "other",
];
const readable = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export function PoultryWorkPlanner({
  orgSlug,
  flockId,
  date,
  members,
  allowed,
}: {
  orgSlug: string;
  flockId: string | null;
  date: string;
  members: Member[];
  allowed: boolean;
}) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      poultryApi.dailyWork.create(orgSlug, flockId!, body),
    onSuccess: () => {
      setOpen(false);
      client.invalidateQueries({ queryKey: ["poultry-work", orgSlug] });
      client.invalidateQueries({ queryKey: ["poultry-my-work", orgSlug] });
    },
  });
  if (!flockId || !allowed) return null;
  const error =
    create.error instanceof ApiError
      ? create.error.message
      : create.error
        ? "The task could not be created."
        : null;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    create.mutate({
      workDate: String(form.get("workDate")),
      workType: String(form.get("workType")),
      title: String(form.get("title")).trim(),
      details: String(form.get("details") ?? "").trim() || null,
      dueAt: String(form.get("dueAt") ?? "") || null,
      assignedMemberId: String(form.get("assignedMemberId") ?? "") || null,
      requiresSupervisorApproval:
        form.get("requiresSupervisorApproval") === "on",
    });
  }
  return (
    <section className="rounded-2xl border border-border bg-gradient-to-br from-surface-1 via-surface-1 to-brand-subtle/20 p-4 shadow-[0_18px_42px_-30px_rgba(15,23,42,.40)] dark:shadow-[0_18px_42px_-30px_rgba(0,0,0,.9)] sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-brand">
            Specific work
          </p>
          <h2 className="mt-1 text-base font-semibold text-ink">
            Plan a task that is not automatic
          </h2>
          <p className="mt-1 text-xs leading-5 text-ink-secondary">
            Use this for checks or follow-up work that does not come from the
            performance model. Automatic daily work remains available above.
          </p>
        </div>
        <Button
          size="sm"
          variant={open ? "ghost" : "secondary"}
          onClick={() => setOpen((value) => !value)}
        >
          <ClipboardPlus />
          {open ? "Close" : "Add task"}
        </Button>
      </div>
      {error ? (
        <p className="mt-4 rounded-lg border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </p>
      ) : null}
      {open ? (
        <form className="mt-5" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Work date" htmlFor="manual-work-date" required>
              <Input name="workDate" type="date" defaultValue={date} required />
            </Field>
            <Field label="Work type" htmlFor="manual-work-type">
              <select
                name="workType"
                defaultValue="other"
                className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
              >
                {workTypes.map((type) => (
                  <option value={type} key={type}>
                    {readable(type)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Task" htmlFor="manual-work-title" required>
              <Input
                name="title"
                required
                placeholder="Inspect feeder line in House A"
              />
            </Field>
            <Field label="Due time" htmlFor="manual-work-due">
              <Input name="dueAt" type="time" />
            </Field>
            <Field label="Assigned employee" htmlFor="manual-work-assignee">
              <select
                name="assignedMemberId"
                defaultValue=""
                className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
              >
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option value={member.id} key={member.id}>
                    {member.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field
            label="Instructions"
            htmlFor="manual-work-details"
            className="mt-4"
          >
            <Textarea
              name="details"
              placeholder="What should the employee check, record or correct?"
            />
          </Field>
          <label className="mt-4 flex items-center gap-2 text-sm text-ink-secondary">
            <input
              name="requiresSupervisorApproval"
              type="checkbox"
              defaultChecked
            />
            Supervisor approval required
          </label>
          <div className="mt-6 flex justify-end">
            <Button type="submit" loading={create.isPending}>
              Create task
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
