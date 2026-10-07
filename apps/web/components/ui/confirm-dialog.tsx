"use client";

/**
 * Professional confirmation dialog, replacing the browser's window.confirm.
 *
 *   if (!(await confirmDialog({ title: "Supprimer ?", tone: "danger" }))) return;
 *
 * One <ConfirmDialogHost /> is mounted in the app providers. The dialog is
 * accessible: role="alertdialog", focus moves into it and returns afterwards,
 * Escape cancels, Tab stays inside, and the destructive button is red.
 */

import * as React from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, HelpCircle, X } from "lucide-react";

export type ConfirmOptions = {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" for deleting or losing work. */
  tone?: "danger" | "default";
};

type Pending = ConfirmOptions & { resolve: (value: boolean) => void };

let current: Pending | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  // Without a mounted host (should not happen) keep a working fallback.
  if (typeof window === "undefined") return Promise.resolve(false);
  if (!listeners.size) return Promise.resolve(window.confirm(options.title));
  current?.resolve(false);
  return new Promise<boolean>((resolve) => {
    current = { ...options, resolve };
    notify();
  });
}

function settle(value: boolean) {
  const pending = current;
  current = null;
  notify();
  pending?.resolve(value);
}

const isFrench = () =>
  typeof document === "undefined" || !document.documentElement.lang || document.documentElement.lang.startsWith("fr");

export function ConfirmDialogHost() {
  const [, render] = React.useReducer((value: number) => value + 1, 0);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const confirmRef = React.useRef<HTMLButtonElement>(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const returnFocus = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    listeners.add(render);
    return () => {
      listeners.delete(render);
    };
  }, []);
  const pending = current;
  React.useEffect(() => {
    if (!pending) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    // Danger: the safe choice (cancel) has the focus; otherwise confirm.
    (pending.tone === "danger" ? cancelRef : confirmRef).current?.focus();
    return () => returnFocus.current?.focus?.();
  }, [pending]);
  if (!pending || typeof document === "undefined") return null;
  const fr = isFrench();
  const danger = pending.tone === "danger";
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      settle(false);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("button");
    if (!focusable?.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center bg-slate-950/45 p-4 backdrop-blur-[2px] sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) settle(false);
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={pending.message ? "confirm-dialog-message" : undefined}
        onKeyDown={onKeyDown}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface-1 text-ink shadow-[0_30px_80px_-24px_rgba(15,23,42,.55)]"
      >
        <div className="flex items-start gap-3 p-5">
          <span
            className={`grid size-10 shrink-0 place-items-center rounded-full ${
              danger ? "bg-red-500/10 text-red-600" : "bg-brand/10 text-brand"
            }`}
          >
            {danger ? <AlertTriangle className="size-5" /> : <HelpCircle className="size-5" />}
          </span>
          <div className="min-w-0 flex-1 pt-1">
            <h2 id="confirm-dialog-title" className="text-base font-semibold leading-6">
              {pending.title}
            </h2>
            {pending.message ? (
              <div id="confirm-dialog-message" className="mt-1.5 whitespace-pre-line text-sm leading-6 text-ink-secondary">
                {pending.message}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => settle(false)}
            className="grid size-8 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink"
            aria-label={fr ? "Fermer" : "Close"}
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-border bg-surface-2/60 px-5 py-3 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => settle(false)}
            className="h-9 rounded-lg border border-border bg-surface-1 px-4 text-sm font-medium text-ink hover:bg-surface-2"
          >
            {pending.cancelLabel ?? (fr ? "Annuler" : "Cancel")}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => settle(true)}
            className={`h-9 rounded-lg px-4 text-sm font-semibold text-white shadow-sm ${
              danger ? "bg-red-600 hover:bg-red-700" : "bg-brand hover:opacity-90"
            }`}
          >
            {pending.confirmLabel ?? (danger ? (fr ? "Supprimer" : "Delete") : fr ? "Confirmer" : "Confirm")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Confirmation from a single sentence (drop-in for window.confirm): the
 * first sentence becomes the title, the rest the explanation, and the main
 * button is named after the action (Supprimer, Remplacer, Retirer…).
 */
export function confirmText(text: string, labels?: { confirm?: string; cancel?: string }): Promise<boolean> {
  const cut = text.search(/\?(\s|$)|\n/);
  const title = (cut >= 0 ? text.slice(0, cut + 1) : text).trim();
  const message = cut >= 0 ? text.slice(cut + 1).trim() : "";
  const verb = title.split(/\s/)[0]?.toLowerCase() ?? "";
  const actions: Record<string, string> = {
    supprimer: "Supprimer",
    retirer: "Retirer",
    remplacer: "Remplacer",
    appliquer: "Appliquer",
    revenir: "Revenir",
    annuler: "Tout annuler",
    delete: "Delete",
    remove: "Remove",
    replace: "Replace",
    apply: "Apply",
    go: "Go back",
    discard: "Discard",
    mark: "Mark as read",
    marquer: "Marquer comme lu",
  };
  const danger = ["supprimer", "retirer", "remplacer", "annuler", "delete", "remove", "replace", "discard"].includes(verb);
  const french = /[àâéèêîôûç«]/i.test(text) || isFrench();
  return confirmDialog({
    title,
    message: message || undefined,
    tone: danger ? "danger" : "default",
    confirmLabel: labels?.confirm ?? actions[verb] ?? (french ? "Continuer" : "Continue"),
    cancelLabel: labels?.cancel,
  });
}
