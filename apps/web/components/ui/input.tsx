"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Renders the error state and wires aria-invalid. */
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input({ className, invalid, type = "text", ...props }, ref) {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "h-9 w-full rounded-md border bg-surface-1 px-3 text-sm text-ink",
          "placeholder:text-ink-muted",
          "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring",
          "disabled:cursor-not-allowed disabled:opacity-60",
          invalid ? "border-critical" : "border-border-strong",
          className,
        )}
        aria-invalid={invalid || undefined}
        {...props}
      />
    );
  },
);

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, rows = 3, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        "w-full rounded-md border bg-surface-1 px-3 py-2 text-sm text-ink",
        "placeholder:text-ink-muted resize-y",
        "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring",
        "disabled:cursor-not-allowed disabled:opacity-60",
        invalid ? "border-critical" : "border-border-strong",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
});

export function Label({
  className,
  required,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label
      className={cn("block text-xs font-medium text-ink-secondary", className)}
      {...props}
    >
      {children}
      {required ? (
        <>
          {" "}
          <span className="text-critical" aria-hidden>
            *
          </span>
          <span className="sr-only">(required)</span>
        </>
      ) : null}
    </label>
  );
}

/**
 * A labelled field with its error message.
 *
 * The error is tied to the input with `aria-describedby` rather than just
 * rendered nearby, so a screen reader announces *why* the field is invalid
 * instead of only that it is.
 */
export function Field({
  label,
  error,
  hint,
  required,
  htmlFor,
  children,
  className,
}: {
  label: string;
  error?: string | undefined;
  hint?: string;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const generatedId = React.useId();
  const fieldId = htmlFor ?? `field-${generatedId.replace(/:/g, "")}`;
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={fieldId} required={required}>
        {label}
      </Label>

      {React.isValidElement(children)
        ? React.cloneElement(
            children as React.ReactElement<Record<string, unknown>>,
            {
              id: fieldId,
              "aria-describedby":
                [error ? errorId : null, hint ? hintId : null]
                  .filter(Boolean)
                  .join(" ") || undefined,
            },
          )
        : children}

      {hint && !error ? (
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}

      {error ? (
        // aria-live so the message is announced when it appears after a submit,
        // not only when the field is next focused.
        <p id={errorId} className="text-xs text-critical" aria-live="polite">
          {error}
        </p>
      ) : null}
    </div>
  );
}
