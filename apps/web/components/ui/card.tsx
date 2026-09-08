import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The surface every dashboard panel sits on.
 *
 * A hairline border rather than a drop shadow: a dashboard shows twenty of these
 * at once, and twenty shadows read as clutter while twenty hairlines read as a
 * grid. It also keeps light and dark looking like the same design instead of
 * one being a washed-out version of the other.
 */
export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-border bg-surface-1", className)}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 px-4 pt-4 pb-3",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  as: Component = "h3",
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & {
  as?: "h2" | "h3" | "h4";
}) {
  return (
    <Component
      className={cn("text-sm font-semibold text-ink", className)}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-xs text-ink-secondary", className)} {...props} />
  );
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 pb-4", className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-t border-border px-4 py-3",
        className,
      )}
      {...props}
    />
  );
}
