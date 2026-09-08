import * as React from "react";
import { AlertCircle, Inbox, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * The four states every panel needs besides "has data".
 *
 * They live together because the mistake is treating them as one: a widget that
 * shows "No data" when the request actually failed, or when the user simply
 * lacks permission, tells the user the business has no data. Those are three
 * different messages and only one of them is about the data.
 */

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-surface-3", className)}
      // Decorative: a screen reader should hear the loading message, not a
      // stack of empty boxes.
      aria-hidden
      {...props}
    />
  );
}

/** Placeholder shaped like the content, so the layout does not jump on load. */
export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4" role="status" aria-label="Loading">
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-3 w-full" />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  className,
}: {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: { label: string; onClick: () => void };
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-4 py-10 text-center",
        className,
      )}
    >
      <Icon className="size-8 text-ink-muted" aria-hidden />
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? (
        <p className="max-w-sm text-xs text-ink-secondary">{description}</p>
      ) : null}
      {action ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={action.onClick}
          className="mt-2"
        >
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A failed request. Distinct from empty on purpose, and it offers a retry —
 * most failures here are a dropped connection on a phone inside a farm
 * building, and the fix is to try again.
 */
export function ErrorState({
  title = "Could not load this",
  description,
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-4 py-10 text-center",
        className,
      )}
      role="alert"
    >
      <AlertCircle className="size-8 text-critical" aria-hidden />
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? (
        <p className="max-w-sm text-xs text-ink-secondary">{description}</p>
      ) : null}
      {onRetry ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={onRetry}
          className="mt-2"
        >
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The caller lacks the permission this panel needs.
 *
 * Says so plainly instead of rendering nothing. A blank space reads as a broken
 * page; this reads as a boundary, and tells them who to ask.
 */
export function NoAccessState({
  what = "this information",
  className,
}: {
  what?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-4 py-10 text-center",
        className,
      )}
    >
      <Lock className="size-7 text-ink-muted" aria-hidden />
      <p className="text-sm font-medium text-ink">No access</p>
      <p className="max-w-sm text-xs text-ink-secondary">
        Your role does not include {what}. Ask an owner or manager to change
        your permissions.
      </p>
    </div>
  );
}
