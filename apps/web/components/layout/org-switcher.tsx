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
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-3 text-[11px] font-semibold text-ink-secondary"
          aria-hidden
        >
          {initialsOf(active.displayName)}
        </span>
        <span className="truncate text-sm font-medium text-ink">
          {active.displayName}
        </span>
      </div>
    );
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex min-w-0 max-w-64 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={switchOrg.isPending}
      >
        <span
          className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-3 text-[11px] font-semibold text-ink-secondary"
          aria-hidden
        >
          {initialsOf(active.displayName)}
        </span>
        <span className="truncate font-medium text-ink">
          {active.displayName}
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
            className="absolute left-0 z-50 mt-1 w-72 overflow-hidden rounded-lg border border-border bg-surface-1 py-1 shadow-lg"
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
                      "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm",
                      isActive
                        ? "bg-surface-2 font-medium text-ink"
                        : "text-ink-secondary hover:bg-surface-2 hover:text-ink",
                    )}
                  >
                    <span
                      className="grid size-6 shrink-0 place-items-center rounded bg-surface-3 text-[10px] font-semibold"
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
            <li className="mt-1 border-t border-border pt-1">
              <Link
                href="/select-organization"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2 text-sm text-ink-secondary hover:bg-surface-2 hover:text-ink"
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
