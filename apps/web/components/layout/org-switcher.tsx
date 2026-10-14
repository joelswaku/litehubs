"use client";
import { useState } from "react";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { cn, initialsOf } from "@/lib/utils";
import { useSessionUser } from "@/stores/session-store";
import { useSwitchOrganization } from "@/hooks/useAuth";
import { useLanguage } from "@/providers/language-provider";
export function OrgSwitcher() {
  const { t } = useLanguage();
  const user = useSessionUser();
  const [open, setOpen] = useState(false);
  const switchOrg = useSwitchOrganization();
  const active = user?.activeOrganization;
  const organizations = user?.organizations ?? [];
  if (!active) return null;
  if (organizations.length <= 1)
    return (
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-[11px] font-semibold text-ink-secondary dark:bg-white/[0.05]"
          aria-hidden
        >
          {initialsOf(active.displayName)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold leading-tight tracking-[-0.01em] text-ink">
            {active.displayName}
          </span>
          <span className="hidden truncate text-[11px] leading-tight text-ink-muted sm:block">
            {t("sidebar.workspaceCaption")}
          </span>
        </span>
      </div>
    );
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-10 min-w-0 max-w-72 items-center gap-2.5 rounded-xl border border-transparent px-1.5 text-sm outline-none transition-all duration-200 hover:border-border hover:bg-surface-1 hover:shadow-[0_1px_2px_rgba(15,23,42,.06)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:hover:bg-white/[0.06]"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={switchOrg.isPending}
      >
        <span
          className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-[11px] font-semibold text-ink-secondary dark:bg-white/[0.05]"
          aria-hidden
        >
          {initialsOf(active.displayName)}
        </span>
        <span className="min-w-0 text-left">
          <span className="block truncate font-semibold leading-tight tracking-[-0.01em] text-ink">
            {active.displayName}
          </span>
          <span className="hidden truncate text-[11px] leading-tight text-ink-muted sm:block">
            {t("sidebar.workspaceCaption")}
          </span>
        </span>
        {switchOrg.isPending ? (
          <Loader2
            className="size-4 shrink-0 animate-spin text-ink-muted"
            aria-hidden
          />
        ) : (
          <ChevronsUpDown
            className="size-4 shrink-0 text-ink-muted"
            aria-hidden
          />
        )}
      </button>
      {open ? (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <ul
            className="absolute left-0 z-50 mt-2 w-80 origin-top-left animate-[menu-in_160ms_ease-out] overflow-hidden rounded-2xl border border-border bg-surface-1 p-1.5 shadow-[0_24px_48px_-20px_rgba(15,23,42,.45),0_2px_6px_rgba(15,23,42,.06)] dark:shadow-[0_24px_48px_-16px_rgba(0,0,0,.7)]"
            role="listbox"
            aria-label={t("org.workspaces")}
          >
            {organizations.map((organization) => {
              const isActive = organization.slug === active.slug;
              return (
                <li
                  key={organization.id}
                  role="option"
                  aria-selected={isActive}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      if (!isActive) switchOrg.mutate(organization.slug);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition",
                      isActive
                        ? "bg-brand/10 font-medium text-ink dark:bg-brand/20"
                        : "text-ink-secondary hover:bg-surface-2 hover:text-ink dark:hover:bg-white/[0.06]",
                    )}
                  >
                    <span
                      className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-[10px] font-semibold dark:bg-white/[0.05]"
                      aria-hidden
                    >
                      {initialsOf(organization.displayName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">
                        {organization.displayName}
                      </span>
                      <span className="block truncate text-xs text-ink-muted">
                        /{organization.slug}
                        {organization.isOwner
                          ? ` · ${t("org.ownerSuffix")}`
                          : ""}
                      </span>
                    </span>
                    {isActive ? (
                      <Check
                        className="size-4 shrink-0 text-brand"
                        aria-hidden
                      />
                    ) : null}
                  </button>
                </li>
              );
            })}
            <li className="mt-1.5 border-t border-border pt-1.5">
              <Link
                href="/select-organization"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-ink-secondary transition hover:bg-surface-2 hover:text-ink dark:hover:bg-white/[0.06]"
              >
                <Plus className="size-4" aria-hidden />
                {t("org.allWorkspaces")}
              </Link>
            </li>
          </ul>
        </>
      ) : null}
    </div>
  );
}
